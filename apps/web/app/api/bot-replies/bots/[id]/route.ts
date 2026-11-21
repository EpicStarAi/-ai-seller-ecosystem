import { NextResponse } from "next/server";
import { requireMember, toPublicBot } from "@/lib/bot-replies/access";
import { parseBotSettings } from "@/lib/bot-replies/settings";
import { PUBLIC_BOT_COLUMNS } from "@/lib/bot-replies/constants";
import { disableBotWebhook, enableBotWebhook, inspectToken, loadBotSecret, newWebhookSecret, storeBotToken } from "@/lib/bot-replies/secrets";
import { looksLikeBotToken } from "@/lib/bot-replies/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwned(supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>, organizationId: string, id: string) {
  const { data } = await supabase.from("bot_autoreplies")
    .select(PUBLIC_BOT_COLUMNS)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const ctx = await requireMember(String(body.organizationId || ""), true);
  if ("response" in ctx) return ctx.response;
  const existing = await loadOwned(ctx.supabase, ctx.organizationId, id);
  if (!existing) return NextResponse.json({ error: "Бот не найден." }, { status: 404 });
  const parsed = parseBotSettings(body, true);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 422 });
  if (parsed.value.operator_mode_enabled === true) {
    const chatId = parsed.value.operator_chat_id ?? existing.operator_chat_id;
    if (!chatId) return NextResponse.json({ error: "Для режима оператора укажите числовой ID чата оператора." }, { status: 422 });
  }

  const patch: Record<string, unknown> = { ...parsed.value, updated_at: new Date().toISOString() };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token) {
    if (!looksLikeBotToken(token)) return NextResponse.json({ error: "Некорректный токен Telegram-бота." }, { status: 422 });
    try {
      const me = await inspectToken(token);
      const secret = await loadBotSecret(id, ctx.organizationId);
      await storeBotToken(id, ctx.organizationId, token, secret?.webhookSecret || newWebhookSecret());
      patch.telegram_bot_id = me.id;
      patch.telegram_username = me.username || null;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось проверить токен." }, { status: 422 });
    }
  }

  const wantEnabled = Object.prototype.hasOwnProperty.call(body, "enabled") ? body.enabled === true : null;
  if (wantEnabled === true) {
    try {
      await enableBotWebhook(id, ctx.organizationId);
      patch.enabled = true;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось включить webhook." }, { status: 409 });
    }
  } else if (wantEnabled === false) {
    await disableBotWebhook(id, ctx.organizationId);
    patch.enabled = false;
  }

  const { data, error } = await ctx.supabase.from("bot_autoreplies")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", ctx.organizationId)
    .select(PUBLIC_BOT_COLUMNS)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Не удалось сохранить настройки бота." }, { status: 500 });
  return NextResponse.json({ bot: toPublicBot(data as Record<string, unknown>, true) });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  const ctx = await requireMember(organizationId, true);
  if ("response" in ctx) return ctx.response;
  const existing = await loadOwned(ctx.supabase, ctx.organizationId, id);
  if (!existing) return NextResponse.json({ error: "Бот не найден." }, { status: 404 });
  await disableBotWebhook(id, ctx.organizationId);
  const { error } = await ctx.supabase.from("bot_autoreplies").delete().eq("id", id).eq("organization_id", ctx.organizationId);
  if (error) return NextResponse.json({ error: "Не удалось удалить бота." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
