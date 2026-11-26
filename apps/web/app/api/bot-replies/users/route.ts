import { NextResponse } from "next/server";
import { requireMember } from "@/lib/bot-replies/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = await requireMember(url.searchParams.get("organizationId") || "");
  if ("response" in ctx) return ctx.response;
  const botId = url.searchParams.get("botId") || "";
  if (!botId) return NextResponse.json({ error: "Не указан botId." }, { status: 400 });
  const { data: bot } = await ctx.supabase.from("bot_autoreplies").select("id")
    .eq("id", botId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (!bot) return NextResponse.json({ error: "Бот не найден." }, { status: 404 });
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const limit = 20;
  const from = (page - 1) * limit;
  let query = ctx.supabase.from("bot_autoreply_users")
    .select("id,telegram_user_id,telegram_chat_id,username,first_name,last_name,reply_count,first_seen_at,last_seen_at", { count: "exact" })
    .eq("organization_id", ctx.organizationId)
    .eq("bot_id", botId)
    .order("last_seen_at", { ascending: false })
    .range(from, from + limit - 1);
  if (q) {
    const like = `%${q.replace(/[%_,]/g, "")}%`;
    query = query.or(`username.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},telegram_user_id.eq.${/^\d+$/.test(q) ? q : 0}`);
  }
  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: "Не удалось загрузить пользователей." }, { status: 500 });
  return NextResponse.json({ users: data || [], total: count || 0, page, limit });
}
