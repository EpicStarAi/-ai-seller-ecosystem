import { NextResponse } from "next/server";
import { requireMember } from "@/lib/bot-replies/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = await requireMember(url.searchParams.get("organizationId") || "");
  if ("response" in ctx) return ctx.response;
  const botId = url.searchParams.get("botId") || "";
  const userId = url.searchParams.get("userId") || "";
  if (!botId || !userId) return NextResponse.json({ error: "Не указаны botId и userId." }, { status: 400 });
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const limit = 50;
  const from = (page - 1) * limit;
  const { data: bot } = await ctx.supabase.from("bot_autoreplies").select("id")
    .eq("id", botId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (!bot) return NextResponse.json({ error: "Бот не найден." }, { status: 404 });
  const { data, error, count } = await ctx.supabase.from("bot_autoreply_messages")
    .select("id,direction,source,body,created_at", { count: "exact" })
    .eq("organization_id", ctx.organizationId)
    .eq("bot_id", botId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .range(from, from + limit - 1);
  if (error) return NextResponse.json({ error: "Не удалось загрузить диалог." }, { status: 500 });
  return NextResponse.json({ messages: data || [], total: count || 0, page, limit });
}
