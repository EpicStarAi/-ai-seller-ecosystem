import { NextResponse } from "next/server";
import { requireMember } from "@/lib/bot-replies/access";
import { loadBotSecret } from "@/lib/bot-replies/secrets";
import { telegramCreateChatInviteLink } from "@/lib/bot-replies/telegram";
import { trafficLeaderboard } from "@/lib/traffic/engine";
import { refLink, sourceLink } from "@/lib/traffic/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = Exclude<Awaited<ReturnType<typeof requireMember>>, { response: NextResponse }>;

async function count(ctx: Ctx, table: string, filters: [string, unknown][], notNull?: string) {
  let query = ctx.supabase.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of filters) query = query.eq(column, value as never);
  if (notNull) query = query.not(notNull, "is", null);
  const { count: total } = await query;
  return total || 0;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = await requireMember(url.searchParams.get("organizationId") || "");
  if ("response" in ctx) return ctx.response;
  const { data: bots } = await ctx.supabase.from("bot_autoreplies")
    .select("id,name,telegram_username,enabled,traffic_enabled,traffic_channel")
    .eq("organization_id", ctx.organizationId).order("created_at");
  const trafficBots = (bots || []).filter((bot) => bot.traffic_enabled);
  const botId = url.searchParams.get("botId") || trafficBots[0]?.id || "";
  const bot = (bots || []).find((row) => row.id === botId);
  if (!bot) return NextResponse.json({ bots: bots || [], bot: null });

  const [users, subscribed, referred, referredSubscribed] = await Promise.all([
    count(ctx, "bot_autoreply_users", [["bot_id", bot.id]]),
    count(ctx, "bot_autoreply_users", [["bot_id", bot.id], ["subscribed", true]]),
    count(ctx, "bot_autoreply_users", [["bot_id", bot.id]], "referred_by"),
    count(ctx, "bot_autoreply_users", [["bot_id", bot.id], ["subscribed", true]], "referred_by"),
  ]);

  const { data: sources } = await ctx.supabase.from("traffic_sources")
    .select("id,tag,name,invite_link,created_at").eq("bot_id", bot.id).order("created_at", { ascending: false });
  const { data: attributed } = await ctx.supabase.from("bot_autoreply_users")
    .select("source_id,subscribed").eq("bot_id", bot.id).not("source_id", "is", null).limit(20000);
  const perSource = new Map<string, { users: number; subscribed: number }>();
  for (const row of attributed || []) {
    const entry = perSource.get(String(row.source_id)) || { users: 0, subscribed: 0 };
    entry.users += 1;
    if (row.subscribed) entry.subscribed += 1;
    perSource.set(String(row.source_id), entry);
  }

  const { data: giveaways } = await ctx.supabase.from("traffic_giveaways")
    .select("id,title,prize,description,status,ends_at,created_at").eq("bot_id", bot.id).order("created_at", { ascending: false });
  const giveawayRows = await Promise.all((giveaways || []).map(async (row) => ({
    ...row,
    entries: await count(ctx, "traffic_giveaway_entries", [["giveaway_id", row.id]]),
  })));

  let leaderboard: Awaited<ReturnType<typeof trafficLeaderboard>> = [];
  try { leaderboard = await trafficLeaderboard(bot.id, 20); } catch { leaderboard = []; }

  const username = bot.telegram_username || "";
  return NextResponse.json({
    bots: bots || [],
    bot: { ...bot, start_link: username ? `https://t.me/${username}` : null, example_ref_link: username ? refLink(username, "КОД") : null },
    stats: { users, subscribed, referred, referredSubscribed },
    sources: (sources || []).map((row) => ({
      ...row,
      deep_link: username ? sourceLink(username, row.tag) : null,
      ...(perSource.get(row.id) || { users: 0, subscribed: 0 }),
    })),
    giveaways: giveawayRows,
    leaderboard,
  });
}

function cleanTag(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const ctx = await requireMember(url.searchParams.get("organizationId") || "", true);
  if ("response" in ctx) return ctx.response;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "");
  const botId = String(body.botId || "");

  const db = ctx.supabase;
  async function loadBot() {
    const { data } = await db.from("bot_autoreplies")
      .select("id,organization_id,telegram_username,traffic_channel")
      .eq("id", botId).eq("organization_id", ctx.organizationId).maybeSingle();
    return data;
  }

  if (action === "create_source") {
    const bot = await loadBot();
    if (!bot) return NextResponse.json({ error: "Бот не найден." }, { status: 404 });
    const name = String(body.name || "").trim().slice(0, 120);
    const tag = cleanTag(body.tag || name);
    if (!name || !tag) return NextResponse.json({ error: "Укажите название и метку источника (латиница, цифры, _)." }, { status: 422 });
    let inviteLink: string | null = null;
    let inviteError: string | null = null;
    if (body.createInvite !== false && bot.traffic_channel) {
      try {
        const secret = await loadBotSecret(bot.id, ctx.organizationId);
        if (secret) inviteLink = (await telegramCreateChatInviteLink(secret.token, bot.traffic_channel, `src_${tag}`)).invite_link || null;
      } catch {
        inviteError = "Не удалось создать ссылку-приглашение в канал: проверьте, что бот — администратор канала с правом приглашать.";
      }
    }
    const { data, error } = await ctx.supabase.from("traffic_sources").insert({
      organization_id: ctx.organizationId, bot_id: bot.id, tag, name, invite_link: inviteLink, created_by: ctx.user.id,
    }).select("id,tag,name,invite_link").maybeSingle();
    if (error || !data) {
      const duplicate = String(error?.code || "") === "23505";
      return NextResponse.json({ error: duplicate ? "Источник с такой меткой уже есть." : "Не удалось создать источник." }, { status: duplicate ? 409 : 500 });
    }
    return NextResponse.json({ ok: true, source: data, inviteError });
  }

  if (action === "delete_source") {
    const { error } = await ctx.supabase.from("traffic_sources").delete()
      .eq("id", String(body.id || "")).eq("organization_id", ctx.organizationId);
    if (error) return NextResponse.json({ error: "Не удалось удалить источник." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "create_giveaway") {
    const bot = await loadBot();
    if (!bot) return NextResponse.json({ error: "Бот не найден." }, { status: 404 });
    const title = String(body.title || "").trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "Укажите название розыгрыша." }, { status: 422 });
    const endsAt = body.endsAt ? new Date(String(body.endsAt)) : null;
    const { data, error } = await ctx.supabase.from("traffic_giveaways").insert({
      organization_id: ctx.organizationId, bot_id: bot.id, title,
      prize: String(body.prize || "").slice(0, 1000), description: String(body.description || "").slice(0, 4000),
      ends_at: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toISOString() : null,
      status: "draft", created_by: ctx.user.id,
    }).select("id").maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Не удалось создать розыгрыш." }, { status: 500 });
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (action === "giveaway_status") {
    const status = String(body.status || "");
    if (!["draft", "active", "finished"].includes(status)) return NextResponse.json({ error: "Неверный статус." }, { status: 422 });
    const id = String(body.id || "");
    const { data: row } = await ctx.supabase.from("traffic_giveaways")
      .select("id,bot_id").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!row) return NextResponse.json({ error: "Розыгрыш не найден." }, { status: 404 });
    if (status === "active") {
      await ctx.supabase.from("traffic_giveaways").update({ status: "finished", updated_at: new Date().toISOString() })
        .eq("bot_id", row.bot_id).eq("status", "active").neq("id", id);
    }
    const { error } = await ctx.supabase.from("traffic_giveaways")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", ctx.organizationId);
    if (error) return NextResponse.json({ error: "Не удалось обновить розыгрыш." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "draw_winner") {
    const id = String(body.id || "");
    const { data: row } = await ctx.supabase.from("traffic_giveaways")
      .select("id,bot_id").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!row) return NextResponse.json({ error: "Розыгрыш не найден." }, { status: 404 });
    const { data: entries } = await ctx.supabase.from("traffic_giveaway_entries")
      .select("user_id").eq("giveaway_id", id).limit(20000);
    if (!entries?.length) return NextResponse.json({ error: "Участников пока нет." }, { status: 409 });
    const ids = entries.map((e) => e.user_id);
    const { data: participants } = await ctx.supabase.from("bot_autoreply_users")
      .select("id,first_name,username,telegram_user_id,subscribed").in("id", ids);
    const { data: invited } = await ctx.supabase.from("bot_autoreply_users")
      .select("referred_by").eq("bot_id", row.bot_id).eq("subscribed", true).in("referred_by", ids).limit(50000);
    const bonus = new Map<string, number>();
    for (const r of invited || []) bonus.set(String(r.referred_by), (bonus.get(String(r.referred_by)) || 0) + 1);
    const pool = (participants || []).filter((p) => p.subscribed).map((p) => ({ p, tickets: 1 + (bonus.get(p.id) || 0) }));
    const total = pool.reduce((sum, item) => sum + item.tickets, 0);
    if (!total) return NextResponse.json({ error: "Нет участников с подтверждённой подпиской." }, { status: 409 });
    let pick = Math.floor(Math.random() * total);
    const winner = pool.find((item) => (pick -= item.tickets) < 0) || pool[0];
    return NextResponse.json({
      ok: true,
      winner: { name: winner.p.first_name || null, username: winner.p.username || null, telegram_user_id: winner.p.telegram_user_id, tickets: winner.tickets },
      totalTickets: total,
      participants: pool.length,
    });
  }

  return NextResponse.json({ error: "Неизвестное действие." }, { status: 400 });
}
