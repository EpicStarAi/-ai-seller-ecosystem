import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request: Request, adminOnly = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (adminOnly && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Нет прав на управление каналами этого рабочего пространства." }, { status: 403 }) };
  }
  const { data: integration, error: integrationError } = await supabase.from("integrations")
    .select("id,kind").eq("organization_id", organizationId).eq("kind", "telegram").maybeSingle();
  if (integrationError || !integration) return { response: NextResponse.json({ error: "Сначала подключите Telegram Bot API в разделе Интеграции." }, { status: 409 }) };
  const { data: stored, error: secretError } = await supabase.from("integration_secrets")
    .select("nonce,ciphertext").eq("integration_id", integration.id).maybeSingle();
  if (secretError || !stored) return { response: NextResponse.json({ error: "Credential Telegram не найден." }, { status: 409 }) };
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
  const ctx = await context(request);
  if ("response" in ctx) return ctx.response;
  const { data, error } = await ctx.supabase.from("telegram_channels")
    .select("id,chat_id,username,title,chat_type,bot_status,can_post_messages,created_at,updated_at")
    .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Не удалось загрузить список каналов." }, { status: 500 });
  return NextResponse.json({ channels: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await context(request, true);
  if ("response" in ctx) return ctx.response;
  let body: { chat?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const chat = typeof body.chat === "string" ? body.chat.trim() : "";
  if (!chat || chat.length > 200 || !/^(?:@?[A-Za-z0-9_]{5,}|-?\d{5,})$/.test(chat)) {
    return NextResponse.json({ error: "Укажите @username публичного канала или числовой chat_id." }, { status: 422 });
  }
  try {
    const me = await telegram(ctx.token, "getMe") as { id: number; username?: string };
    const chatInfo = await telegram(ctx.token, "getChat", { chat_id: chat.startsWith("@") ? chat : chat }) as {
      id: number; type: string; title?: string; username?: string;
    };
    if (chatInfo.type !== "channel") return NextResponse.json({ error: "Указанный чат не является каналом Telegram." }, { status: 422 });
    const member = await telegram(ctx.token, "getChatMember", { chat_id: chatInfo.id, user_id: me.id }) as {
      status: string; can_post_messages?: boolean;
    };
    const canPost = member.status === "creator" || (member.status === "administrator" && member.can_post_messages === true);
    if (!canPost) return NextResponse.json({ error: "Бот найден, но не имеет права публикации. Добавьте его администратором канала с разрешением «Публикация сообщений»." }, { status: 422 });
    const row = {
      organization_id: ctx.organizationId, integration_id: ctx.integrationId, chat_id: String(chatInfo.id),
      username: chatInfo.username ?? null, title: chatInfo.title ?? chatInfo.username ?? String(chatInfo.id),
      chat_type: chatInfo.type, bot_status: member.status, can_post_messages: canPost,
      metadata: { bot_username: me.username ?? null, verified_at: new Date().toISOString() }, updated_at: new Date().toISOString(),
    };
    const { data, error } = await ctx.supabase.from("telegram_channels").upsert(row, { onConflict: "organization_id,chat_id" })
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
