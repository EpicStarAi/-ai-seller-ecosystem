import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request: Request, adminOnly = false, requestedIntegrationId = "") {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (adminOnly && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Нет прав на управление каналами этого рабочего пространства." }, { status: 403 }) };
  }
  if (!requestedIntegrationId) return { supabase, organizationId };
  const { data: integration, error: integrationError } = await supabase.from("integrations")
    .select("id,kind").eq("id", requestedIntegrationId).eq("organization_id", organizationId)
    .eq("kind", "telegram").eq("status", "connected").maybeSingle();
  if (integrationError || !integration) return { response: NextResponse.json({ error: "Выбранный Telegram-бот не подключён к этому рабочему пространству." }, { status: 409 }) };
  const { data: stored, error: secretError } = await supabase.from("integration_secrets")
    .select("nonce,ciphertext").eq("integration_id", integration.id).maybeSingle();
  if (secretError || !stored) return { response: NextResponse.json({ error: "Credential выбранного Telegram-бота не найден." }, { status: 409 }) };
  let token: string;
  try { token = decryptIntegrationSecret(stored.nonce, stored.ciphertext, organizationId, "telegram"); }
  catch { return { response: NextResponse.json({ error: "Не удалось расшифровать Telegram credential." }, { status: 500 }) }; }
  return { supabase, organizationId, integrationId: integration.id, token };
}

async function telegram(token: string, method: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(typeof data.description === "string" ? data.description : "Telegram Bot API request failed.");
  return data.result;
}

export async function GET(request: Request) {
  const ctx = await context(request, false, "");
  if ("response" in ctx) return ctx.response;
  const integrationId = new URL(request.url).searchParams.get("integrationId") || "";
  let query = ctx.supabase.from("telegram_channels")
    .select("id,integration_id,chat_id,username,title,chat_type,bot_status,can_post_messages,created_at,updated_at")
    .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false });
  if (integrationId) query = query.eq("integration_id", integrationId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Не удалось загрузить список каналов." }, { status: 500 });
  return NextResponse.json({ channels: data ?? [] });
}

export async function POST(request: Request) {
  let body: { chat?: string; integrationId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const requestedIntegrationId = typeof body.integrationId === "string" ? body.integrationId : "";
  if (!requestedIntegrationId) return NextResponse.json({ error: "Выберите Telegram-бота для этого канала." }, { status: 422 });
  const ctx = await context(request, true, requestedIntegrationId);
  if ("response" in ctx) return ctx.response;
  const token = "token" in ctx ? ctx.token : "";
  const selectedIntegrationId = "integrationId" in ctx ? ctx.integrationId : "";
  if (!token || !selectedIntegrationId) return NextResponse.json({ error: "Не удалось разрешить выбранного Telegram-бота." }, { status: 409 });
  const chat = typeof body.chat === "string" ? body.chat.trim() : "";
  if (!chat || chat.length > 200 || !/^(?:@?[A-Za-z0-9_]{5,}|-?\d{5,})$/.test(chat)) {
    return NextResponse.json({ error: "Укажите @username публичного канала или числовой chat_id." }, { status: 422 });
  }
  try {
    const me = await telegram(token, "getMe") as { id: number; username?: string };
    const chatInfo = await telegram(token, "getChat", { chat_id: chat.startsWith("@") ? chat : chat }) as {
      id: number; type: string; title?: string; username?: string;
    };
    if (chatInfo.type !== "channel") return NextResponse.json({ error: "Указанный чат не является каналом Telegram." }, { status: 422 });
    const member = await telegram(token, "getChatMember", { chat_id: chatInfo.id, user_id: me.id }) as {
      status: string; can_post_messages?: boolean;
    };
    const canPost = member.status === "creator" || (member.status === "administrator" && member.can_post_messages === true);
    if (!canPost) return NextResponse.json({ error: "Бот найден, но не имеет права публикации. Добавьте его администратором канала с разрешением «Публикация сообщений»." }, { status: 422 });
    const row = {
      organization_id: ctx.organizationId, integration_id: selectedIntegrationId, chat_id: String(chatInfo.id),
      username: chatInfo.username ?? null, title: chatInfo.title ?? chatInfo.username ?? String(chatInfo.id),
      chat_type: chatInfo.type, bot_status: member.status, can_post_messages: canPost,
      metadata: { bot_username: me.username ?? null, verified_at: new Date().toISOString() }, updated_at: new Date().toISOString(),
    };
    const { data, error } = await ctx.supabase.from("telegram_channels").upsert(row, { onConflict: "organization_id,chat_id,integration_id" })
      .select("id,chat_id,username,title,chat_type,bot_status,can_post_messages,created_at,updated_at").single();
    if (error) return NextResponse.json({ error: "Канал проверен, но не удалось сохранить запись." }, { status: 500 });
    return NextResponse.json({ channel: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось проверить канал через Telegram.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const ctx = await context(request, true);
  if ("response" in ctx) return ctx.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не указан id канала." }, { status: 400 });
  const { error } = await ctx.supabase.from("telegram_channels").delete()
    .eq("id", id).eq("organization_id", ctx.organizationId);
  if (error) return NextResponse.json({ error: "Не удалось удалить канал." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
