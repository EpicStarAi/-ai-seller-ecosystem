import { NextResponse } from "next/server";
import { requireMember } from "@/lib/bot-replies/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = await requireMember(url.searchParams.get("organizationId") || "");
  if ("response" in ctx) return ctx.response;
  const botId = url.searchParams.get("botId") || "";
  const { data: bot } = await ctx.supabase.from("bot_autoreplies").select("id,name")
    .eq("id", botId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (!bot) return NextResponse.json({ error: "Бот не найден." }, { status: 404 });
  const { data, error } = await ctx.supabase.from("bot_autoreply_users")
    .select("telegram_user_id,username,first_name,last_name,telegram_chat_id,reply_count,first_seen_at,last_seen_at")
    .eq("organization_id", ctx.organizationId)
    .eq("bot_id", botId)
    .order("last_seen_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: "Не удалось выгрузить пользователей." }, { status: 500 });
  const header = ["telegram_user_id","username","first_name","last_name","telegram_chat_id","reply_count","first_seen_at","last_seen_at"];
  const lines = [header.join(",")];
  for (const row of data || []) {
    lines.push(header.map((key) => csvEscape((row as Record<string, unknown>)[key])).join(","));
  }
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"bot-users.csv\"",
      "Cache-Control": "no-store",
    },
  });
}
