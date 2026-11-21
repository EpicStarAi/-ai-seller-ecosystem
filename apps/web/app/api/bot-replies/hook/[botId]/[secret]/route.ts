import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadBotSecret } from "@/lib/bot-replies/secrets";
import { handleBotUpdate } from "@/lib/bot-replies/engine";
import { PUBLIC_BOT_COLUMNS } from "@/lib/bot-replies/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request, context: { params: Promise<{ botId: string; secret: string }> }) {
  const { botId, secret } = await context.params;
  const header = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!botId || !secret || !header || !safeEqual(secret, header)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const supabase = createServiceClient();
  const { data: bot } = await supabase.from("bot_autoreplies")
    .select(PUBLIC_BOT_COLUMNS)
    .eq("id", botId)
    .maybeSingle();
  if (!bot) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const stored = await loadBotSecret(bot.id, bot.organization_id);
  if (!stored || !safeEqual(stored.webhookSecret, secret) || !safeEqual(stored.webhookSecret, header)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!bot.enabled) return NextResponse.json({ ok: true, ignored: true });
  const update = await request.json().catch(() => null);
  if (!update || typeof update !== "object") return NextResponse.json({ ok: true });
  try {
    await handleBotUpdate(bot, stored.token, update);
  } catch {
    // Acknowledge so Telegram does not hammer retries with the same secret.
  }
  return NextResponse.json({ ok: true });
}
