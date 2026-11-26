import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request: Request, write = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) return { response: NextResponse.json({ error: "Не указано рабочее пространство." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (write && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав для управления кампаниями." }, { status: 403 }) };
  }
  return { supabase, user, organizationId };
}

export async function GET(request: Request) {
  const ctx = await context(request);
  if ("response" in ctx) return ctx.response;
  const [{ data: campaigns, error }, { count, error: countError }] = await Promise.all([
    ctx.supabase.from("telegram_campaigns")
      .select("id,name,message_text,audience_type,status,scheduled_at,created_at,updated_at,telegram_channels(title,username)")
      .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(100),
    ctx.supabase.from("telegram_subscribers").select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId).eq("status", "subscribed"),
  ]);
  if (error || countError) return NextResponse.json({ error: "Не удалось загрузить кампании." }, { status: 500 });
  return NextResponse.json({ campaigns: campaigns ?? [], optedInSubscribers: count ?? 0 });
}

export async function POST(request: Request) {
  const ctx = await context(request, true);
  if ("response" in ctx) return ctx.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const messageText = typeof body.messageText === "string" ? body.messageText.trim() : "";
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  if (!name || !messageText || !channelId) return NextResponse.json({ error: "Заполните название, канал и текст сообщения." }, { status: 422 });
  if (messageText.length > 4096) return NextResponse.json({ error: "Текст сообщения не должен превышать 4096 символов." }, { status: 422 });
  const { data: channel, error: channelError } = await ctx.supabase.from("telegram_channels")
    .select("id,can_post_messages").eq("id", channelId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (channelError || !channel || !channel.can_post_messages) return NextResponse.json({ error: "Выберите подключённый канал с правом публикации." }, { status: 422 });
  const { data, error } = await ctx.supabase.from("telegram_campaigns").insert({
    organization_id: ctx.organizationId, channel_id: channelId, name, message_text: messageText,
    audience_type: "bot_subscribers", status: "draft", created_by: ctx.user.id,
  }).select("id,name,status,created_at").single();
  if (error) return NextResponse.json({ error: "Не удалось сохранить кампанию." }, { status: 500 });
  return NextResponse.json({
    campaign: data,
    message: "Кампания сохранена как черновик. Отправка не запускалась. Рассылка будет доступна только подписчикам, которые сами начали диалог с ботом и дали согласие.",
  }, { status: 201 });
}

export async function DELETE(request: Request) {
  const ctx = await context(request, true);
  if ("response" in ctx) return ctx.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не указан id кампании." }, { status: 400 });
  const { error } = await ctx.supabase.from("telegram_campaigns").delete()
    .eq("id", id).eq("organization_id", ctx.organizationId).eq("status", "draft");
  if (error) return NextResponse.json({ error: "Не удалось удалить черновик." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
