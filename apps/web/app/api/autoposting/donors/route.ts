import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request: Request, adminOnly = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") || "";
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (adminOnly && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав для управления источниками." }, { status: 403 }) };
  }
  return { supabase, user, organizationId };
}

async function telegramToken(supabase: Awaited<ReturnType<typeof createClient>>, organizationId: string) {
  const { data: integration, error: integrationError } = await supabase.from("integrations")
    .select("id").eq("organization_id", organizationId).eq("kind", "telegram").maybeSingle();
  if (integrationError || !integration) throw new Error("Telegram Bot API не подключён.");
  const { data: secret, error: secretError } = await supabase.from("integration_secrets")
    .select("nonce,ciphertext").eq("integration_id", integration.id).maybeSingle();
  if (secretError || !secret) throw new Error("Telegram credential не найден.");
  return decryptIntegrationSecret(secret.nonce, secret.ciphertext, organizationId, "telegram");
}

async function telegram(token: string, method: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(typeof data.description === "string" ? data.description : "Telegram Bot API request failed.");
  return data.result;
}

export async function GET(request: Request) {
  const ctx = await context(request);
  if ("response" in ctx) return ctx.response;
  const flowId = new URL(request.url).searchParams.get("flowId") || "";
  if (!flowId) return NextResponse.json({ error: "Не указан поток." }, { status: 400 });
  const { data: flow } = await ctx.supabase.from("autoposting_flows").select("id,source_type")
    .eq("id", flowId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (!flow) return NextResponse.json({ error: "Поток не найден." }, { status: 404 });
  const { data, error } = await ctx.supabase.from("autoposting_donors")
    .select("id,flow_id,source_type,chat_id,username,title,access_status,bot_can_receive_posts,last_checked_at,created_at")
    .eq("organization_id", ctx.organizationId).eq("flow_id", flowId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Не удалось загрузить источники." }, { status: 500 });
  return NextResponse.json({ donors: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await context(request, true);
  if ("response" in ctx) return ctx.response;
  let body: { flowId?: string; chat?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const flowId = typeof body.flowId === "string" ? body.flowId : "";
  const chat = typeof body.chat === "string" ? body.chat.trim() : "";
  if (!flowId || !chat || chat.length > 200 || !/^(?:@?[A-Za-z0-9_]{5,}|-?\d{5,}|https?:\/\/t\.me\/[A-Za-z0-9_]{5,})$/.test(chat)) {
    return NextResponse.json({ error: "Укажите поток и @username, ссылку t.me/канал или числовой Telegram Chat ID." }, { status: 422 });
  }
  const { data: flow, error: flowError } = await ctx.supabase.from("autoposting_flows")
    .select("id,source_type").eq("id", flowId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (flowError || !flow) return NextResponse.json({ error: "Поток не найден в этом рабочем пространстве." }, { status: 404 });
  if (flow.source_type !== "telegram_channels") return NextResponse.json({ error: "У этого потока выбран источник «Поиск по интернету». Создайте отдельный поток с источником Telegram-каналы." }, { status: 409 });
  let chatRef = chat;
  if (/^https?:\/\/t\.me\//i.test(chat)) chatRef = "@" + chat.replace(/^https?:\/\/t\.me\//i, "").split(/[/?#]/)[0];
  try {
    const token = await telegramToken(ctx.supabase, ctx.organizationId);
    const me = await telegram(token, "getMe") as { id: number };
    const info = await telegram(token, "getChat", { chat_id: chatRef }) as { id: number; type: string; title?: string; username?: string };
    if (info.type !== "channel") return NextResponse.json({ error: "Ссылка ведёт не на Telegram-канал." }, { status: 422 });
    let membershipStatus: string | null = null;
    let membershipVerified = true;
    try {
      const member = await telegram(token, "getChatMember", { chat_id: info.id, user_id: me.id }) as { status: string };
      membershipStatus = member.status;
    } catch (memberError) {
      const reason = memberError instanceof Error ? memberError.message.toLowerCase() : "";
      if (!reason.includes("member list is inaccessible")) throw memberError;
      membershipVerified = false;
    }
    const inChannel = membershipVerified && ["member", "administrator", "creator"].includes(membershipStatus ?? "");
    const now = new Date().toISOString();
    const row = {
      organization_id: ctx.organizationId, flow_id: flowId, source_type: "telegram_channel",
      chat_id: String(info.id), username: info.username ?? null,
      title: info.title ?? info.username ?? String(info.id),
      access_status: !membershipVerified ? "membership_unverified" : inChannel ? "bot_member" : "bot_not_member",
      bot_can_receive_posts: inChannel, last_checked_at: now,
      metadata: { checked_by: "telegram_bot_api", membership_verified: membershipVerified, membership_status: membershipStatus }, created_by: ctx.user.id, updated_at: now,
    };
    const { data, error } = await ctx.supabase.from("autoposting_donors")
      .upsert(row, { onConflict: "organization_id,flow_id,chat_id" })
      .select("id,flow_id,chat_id,username,title,access_status,bot_can_receive_posts,last_checked_at").single();
    if (error) return NextResponse.json({ error: "Канал проверен, но не удалось сохранить источник." }, { status: 500 });
    return NextResponse.json({
      donor: data,
      message: "Канал найден и сохранён. Мониторинг публикаций идёт через пользовательский аккаунт Telegram, а не через бота. Для публичных каналов добавлять бота администратором не нужно.",
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось проверить источник через Telegram Bot API.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const ctx = await context(request, true);
  if ("response" in ctx) return ctx.response;
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const flowId = url.searchParams.get("flowId") || "";
  if (!id || !flowId) return NextResponse.json({ error: "Не указаны параметры удаления." }, { status: 400 });
  const { error } = await ctx.supabase.from("autoposting_donors").delete()
    .eq("id", id).eq("flow_id", flowId).eq("organization_id", ctx.organizationId);
  if (error) return NextResponse.json({ error: "Не удалось удалить источник." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
