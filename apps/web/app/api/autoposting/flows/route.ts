import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePostButtons } from "@/lib/telegram/post-buttons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(request: Request, organizationId: string, write = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (write && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав для управления потоками." }, { status: 403 }) };
  }
  return { supabase, user };
}

function parsePayload(body: any) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const sourceType = body.sourceType;
  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((v: unknown) => typeof v === "string").map((v: string) => v.trim()).filter(Boolean).slice(0, 30)
    : [];
  const aiPrompt = typeof body.aiPrompt === "string" ? body.aiPrompt.trim().slice(0, 10000) : "";
  const scheduleMode = body.scheduleMode === "cron" ? "cron" : "interval";
  const intervalMinutes = Number(body.intervalMinutes ?? 60);
  const cronExpression = typeof body.cronExpression === "string" ? body.cronExpression.trim().slice(0, 120) : null;
  if (!name || !channelId || !["web_search", "telegram_channels"].includes(sourceType) || !aiPrompt) {
    return { error: "Заполните название, канал, источник и AI-инструкцию." };
  }
  if (scheduleMode === "interval" && (!Number.isInteger(intervalMinutes) || intervalMinutes < 30 || intervalMinutes > 43200)) {
    return { error: "Интервал должен быть целым числом от 30 до 43200 минут." };
  }
  if (scheduleMode === "cron" && !cronExpression) return { error: "Укажите CRON-выражение." };
  const value: Record<string, unknown> = {
    name, channel_id: channelId, source_type: sourceType, keywords, ai_prompt: aiPrompt,
    use_ai_editor: body.useAiEditor === true, generate_image: body.generateImage === true,
    moderation_enabled: body.moderationEnabled === true,
    // MAX is recorded as a preference only; no MAX connector is active in this deployment.
    max_forwarding_enabled: body.maxForwardingEnabled === true,
    schedule_mode: scheduleMode, interval_minutes: scheduleMode === "interval" ? intervalMinutes : 60,
    cron_expression: scheduleMode === "cron" ? cronExpression : null,
  };
  if (Object.prototype.hasOwnProperty.call(body, "postButtons") || Object.prototype.hasOwnProperty.call(body, "post_buttons")) {
    const parsedButtons = parsePostButtons(body.postButtons ?? body.post_buttons);
    if (!Array.isArray(parsedButtons)) return { error: parsedButtons.error };
    value.post_buttons = parsedButtons;
  }
  return { value };
}

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  if (!organizationId) return NextResponse.json({ error: "Не указан organizationId." }, { status: 400 });
  const ctx = await access(request, organizationId);
  if ("response" in ctx) return ctx.response;
  const { data, error } = await ctx.supabase.from("autoposting_flows")
    .select("id,name,channel_id,source_type,keywords,ai_prompt,use_ai_editor,generate_image,moderation_enabled,max_forwarding_enabled,schedule_mode,interval_minutes,cron_expression,status,post_buttons,created_at,updated_at,telegram_channels(title,username)")
    .eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Не удалось загрузить потоки автопостинга." }, { status: 500 });
  return NextResponse.json({ flows: data ?? [] });
}

export async function POST(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  if (!organizationId) return NextResponse.json({ error: "Не указано рабочее пространство." }, { status: 400 });
  const ctx = await access(request, organizationId, true);
  if ("response" in ctx) return ctx.response;
  const parsed = parsePayload(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const { data: channel, error: channelError } = await ctx.supabase.from("telegram_channels")
    .select("id,can_post_messages").eq("id", parsed.value.channel_id).eq("organization_id", organizationId).maybeSingle();
  if (channelError || !channel || !channel.can_post_messages) {
    return NextResponse.json({ error: "Выбранный канал не найден в этом пространстве или бот не имеет права публикации." }, { status: 422 });
  }
  const { data, error } = await ctx.supabase.from("autoposting_flows")
    .insert({ ...parsed.value, organization_id: organizationId, created_by: ctx.user.id, status: "draft" })
    .select("id,name,status,created_at").single();
  if (error) return NextResponse.json({ error: "Не удалось сохранить поток автопостинга." }, { status: 500 });
  return NextResponse.json({ flow: data, message: "Настройки сохранены как черновик. Автоматическая публикация пока не запускалась." }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const id = typeof body.id === "string" ? body.id : "";
  if (!organizationId || !id) return NextResponse.json({ error: "Не указаны параметры потока." }, { status: 400 });
  const ctx = await access(request, organizationId, true);
  if ("response" in ctx) return ctx.response;
  const parsed = parsePayload(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const { data: channel } = await ctx.supabase.from("telegram_channels").select("id,can_post_messages")
    .eq("id", parsed.value.channel_id).eq("organization_id", organizationId).maybeSingle();
  if (!channel?.can_post_messages) return NextResponse.json({ error: "Канал не подключён или публикация запрещена." }, { status: 422 });
  const { data, error } = await ctx.supabase.from("autoposting_flows").update({ ...parsed.value, status: "draft", updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", organizationId).select("id,name,status,updated_at").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Не удалось обновить поток." }, { status: 500 });
  return NextResponse.json({ flow: data, message: "Изменения сохранены. Поток остаётся черновиком." });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") || "";
  const id = url.searchParams.get("id") || "";
  if (!organizationId || !id) return NextResponse.json({ error: "Не указаны параметры удаления." }, { status: 400 });
  const ctx = await access(request, organizationId, true);
  if ("response" in ctx) return ctx.response;
  const { error } = await ctx.supabase.from("autoposting_flows").delete().eq("id", id).eq("organization_id", organizationId);
  if (error) return NextResponse.json({ error: "Не удалось удалить поток." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
