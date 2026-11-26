import { NextResponse } from "next/server";
import { requireMember, toPublicBot } from "@/lib/bot-replies/access";
import { parseBotSettings } from "@/lib/bot-replies/settings";
import { PUBLIC_BOT_COLUMNS } from "@/lib/bot-replies/constants";
import { inspectToken, newWebhookSecret, storeBotToken } from "@/lib/bot-replies/secrets";
import { looksLikeBotToken } from "@/lib/bot-replies/telegram";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  const ctx = await requireMember(organizationId);
  if ("response" in ctx) return ctx.response;
  const { data, error } = await ctx.supabase.from("bot_autoreplies")
    .select(PUBLIC_BOT_COLUMNS)
    .eq("organization_id", ctx.organizationId)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Не удалось загрузить ботов." }, { status: 500 });
  const bots = (data || []).map((row) => toPublicBot(row as Record<string, unknown>, true));
  const counts: Record<string, number> = {};
  if (bots.length) {
    const service = createServiceClient();
    const { data: users } = await service.from("bot_autoreply_users")
      .select("bot_id")
      .in("bot_id", bots.map((bot) => bot.id));
    for (const row of users || []) {
      const id = String((row as { bot_id: string }).bot_id);
      counts[id] = (counts[id] || 0) + 1;
    }
  }
  return NextResponse.json({ bots: bots.map((bot) => ({ ...bot, user_count: counts[bot.id] || 0 })) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = String(body.organizationId || "");
  const ctx = await requireMember(organizationId, true);
  if ("response" in ctx) return ctx.response;
  const parsed = parseBotSettings(body, false);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!looksLikeBotToken(token)) return NextResponse.json({ error: "Укажите токен Telegram-бота." }, { status: 422 });

  let me;
  try {
    me = await inspectToken(token);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось проверить токен." }, { status: 422 });
  }

  const now = new Date().toISOString();
  const { data, error } = await ctx.supabase.from("bot_autoreplies").insert({
    ...parsed.value,
    organization_id: ctx.organizationId,
    created_by: ctx.user.id,
    enabled: false,
    telegram_bot_id: me.id,
    telegram_username: me.username || null,
    created_at: now,
    updated_at: now,
  }).select(PUBLIC_BOT_COLUMNS).maybeSingle();
  if (error || !data) {
    const conflict = String((error as { code?: string } | null)?.code || "") === "23505";
    return NextResponse.json({ error: conflict ? "Этот бот уже подключён." : "Не удалось сохранить бота." }, { status: conflict ? 409 : 500 });
  }
  try {
    await storeBotToken(data.id, ctx.organizationId, token, newWebhookSecret());
  } catch {
    await ctx.supabase.from("bot_autoreplies").delete().eq("id", data.id).eq("organization_id", ctx.organizationId);
    return NextResponse.json({ error: "Не удалось сохранить токен бота." }, { status: 500 });
  }
  return NextResponse.json({ bot: toPublicBot(data as Record<string, unknown>, true), message: "Бот сохранён и выключен. Webhook не устанавливался." });
}
