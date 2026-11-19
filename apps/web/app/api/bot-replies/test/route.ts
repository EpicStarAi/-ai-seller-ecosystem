import { NextResponse } from "next/server";
import { requireMember } from "@/lib/bot-replies/access";
import { generateWithFallback } from "@/lib/ai/fallback";
import { autoReplySystemPrompt } from "@/lib/bot-replies/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const ctx = await requireMember(String(body.organizationId || ""), true);
  if ("response" in ctx) return ctx.response;
  const botId = String(body.botId || "");
  const text = String(body.text || "").trim();
  if (!botId) return NextResponse.json({ error: "Не указан бот." }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Введите текст для проверки." }, { status: 422 });
  const { data: bot } = await ctx.supabase.from("bot_autoreplies")
    .select("id,ai_enabled,prompt_id,knowledge_base")
    .eq("id", botId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (!bot) return NextResponse.json({ error: "Бот не найден." }, { status: 404 });
  if (!bot.ai_enabled) {
    return NextResponse.json({ error: "Включите «Отвечать через AI» в настройках бота, чтобы тестировать ответ." }, { status: 409 });
  }
  let promptText = "";
  if (bot.prompt_id) {
    const { data: saved } = await ctx.supabase.from("user_prompts")
      .select("prompt_text").eq("id", bot.prompt_id).eq("organization_id", ctx.organizationId).maybeSingle();
    promptText = saved?.prompt_text || "";
  }
  try {
    const generated = await generateWithFallback(
      ctx.organizationId,
      autoReplySystemPrompt(promptText, bot.knowledge_base || ""),
      text,
    );
    return NextResponse.json({ text: generated.text, provider: generated.provider, model: generated.model, sent: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось получить тестовый ответ." }, { status: 502 });
  }
}
