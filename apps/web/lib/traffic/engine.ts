import "server-only";

import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isSubscribedStatus, telegramAnswerCallbackQuery, telegramGetChatMember, telegramSendMessage,
} from "@/lib/bot-replies/telegram";
import {
  DEFAULT_CHANNEL_URL, DEFAULT_SHOP_URL, DEFAULT_TRAFFIC_WELCOME, channelUrl, refLink,
} from "@/lib/traffic/constants";

export type TrafficBot = {
  id: string;
  organization_id: string;
  telegram_username: string | null;
  main_message: string;
  ai_enabled: boolean;
  operator_mode_enabled: boolean;
  traffic_enabled?: boolean;
  traffic_channel?: string | null;
  traffic_welcome?: string | null;
};

type TgFrom = { id: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string; language_code?: string };
type TgMessage = { message_id: number; text?: string; caption?: string; from?: TgFrom; chat?: { id: number; type?: string } };
type TgCallback = { id: string; from: TgFrom; data?: string; message?: { message_id: number; chat?: { id: number; type?: string } } };
export type TrafficUpdate = { message?: TgMessage; callback_query?: TgCallback };

type TrafficUser = {
  id: string;
  telegram_chat_id: string;
  telegram_user_id: number;
  ref_code: string | null;
  referred_by: string | null;
  subscribed: boolean;
  subscribed_checked_at: string | null;
  isNew: boolean;
};

const USER_COLUMNS = "id,telegram_chat_id,telegram_user_id,ref_code,referred_by,subscribed,subscribed_checked_at";
const RECHECK_MS = 6 * 60 * 60 * 1000;

function newRefCode() {
  return randomBytes(6).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase() || randomBytes(4).toString("hex");
}

function parseStart(text: string) {
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?/i.exec(text);
  if (!match) return null;
  const payload = (match[1] || "").trim();
  const ref = /^ref_([a-z0-9]{4,16})$/i.exec(payload)?.[1]?.toLowerCase() || null;
  const src = /^src_([a-z0-9_]{1,32})$/i.exec(payload)?.[1]?.toLowerCase() || null;
  return { ref, src };
}

function command(text: string) {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text);
  return match ? match[1].toLowerCase() : null;
}

function displayName(row: { first_name?: string | null; username?: string | null }) {
  const name = (row.first_name || "").trim() || (row.username ? row.username : "") || "Игрок";
  return name.slice(0, 24);
}

async function ensureUser(bot: TrafficBot, from: TgFrom, chatId: string, attribution?: { ref: string | null; src: string | null }) {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from("bot_autoreply_users")
    .select(USER_COLUMNS).eq("bot_id", bot.id).eq("telegram_user_id", from.id).maybeSingle();
  const profile = {
    telegram_chat_id: chatId,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    language_code: from.language_code || null,
    last_seen_at: now,
  };
  if (existing) {
    const patch: Record<string, unknown> = { ...profile };
    if (!existing.ref_code) patch.ref_code = newRefCode();
    await supabase.from("bot_autoreply_users").update(patch).eq("id", existing.id);
    return { ...existing, ref_code: (patch.ref_code as string) || existing.ref_code, isNew: false } as TrafficUser;
  }
  let referredBy: string | null = null;
  let sourceId: string | null = null;
  if (attribution?.ref) {
    const { data: referrer } = await supabase.from("bot_autoreply_users")
      .select("id,telegram_user_id").eq("bot_id", bot.id).eq("ref_code", attribution.ref).maybeSingle();
    if (referrer && Number(referrer.telegram_user_id) !== from.id) referredBy = referrer.id;
  }
  if (attribution?.src) {
    const { data: source } = await supabase.from("traffic_sources")
      .select("id").eq("bot_id", bot.id).eq("tag", attribution.src).maybeSingle();
    if (source) sourceId = source.id;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase.from("bot_autoreply_users").insert({
      organization_id: bot.organization_id,
      bot_id: bot.id,
      telegram_user_id: from.id,
      reply_count: 0,
      first_seen_at: now,
      ref_code: newRefCode(),
      referred_by: referredBy,
      source_id: sourceId,
      ...profile,
    }).select(USER_COLUMNS).maybeSingle();
    if (data) return { ...data, isNew: true } as TrafficUser;
    if (error && !String(error.code || "").startsWith("23")) break;
    const { data: raced } = await supabase.from("bot_autoreply_users")
      .select(USER_COLUMNS).eq("bot_id", bot.id).eq("telegram_user_id", from.id).maybeSingle();
    if (raced) return { ...raced, isNew: false } as TrafficUser;
  }
  return null;
}

async function log(bot: TrafficBot, userId: string, direction: "in" | "out", body: string, chatId: string, messageId?: number | null) {
  const supabase = createServiceClient();
  await supabase.from("bot_autoreply_messages").insert({
    organization_id: bot.organization_id,
    bot_id: bot.id,
    user_id: userId,
    direction,
    source: direction === "in" ? "user" : "traffic",
    body: body.slice(0, 8192) || "[без текста]",
    telegram_chat_id: chatId,
    telegram_message_id: messageId ?? null,
  });
}

async function send(bot: TrafficBot, token: string, user: TrafficUser, text: string, keyboard?: unknown[][]) {
  const extra: Record<string, unknown> = { disable_web_page_preview: true };
  if (keyboard) extra.reply_markup = { inline_keyboard: keyboard };
  const sent = await telegramSendMessage(token, user.telegram_chat_id, text, extra);
  await log(bot, user.id, "out", text, user.telegram_chat_id, sent?.message_id ?? null);
}

/** Returns true/false when Telegram answered, null when the bot cannot check (e.g. not an admin of the channel). */
async function checkSubscription(bot: TrafficBot, token: string, telegramUserId: number, rowId: string) {
  const channel = (bot.traffic_channel || "").trim();
  if (!channel) return null;
  try {
    const member = await telegramGetChatMember(token, channel, telegramUserId);
    const subscribed = isSubscribedStatus(member);
    const supabase = createServiceClient();
    await supabase.from("bot_autoreply_users")
      .update({ subscribed, subscribed_checked_at: new Date().toISOString() }).eq("id", rowId);
    return subscribed;
  } catch {
    return null;
  }
}

async function refreshInvited(bot: TrafficBot, token: string, userId: string) {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - RECHECK_MS).toISOString();
  const { data } = await supabase.from("bot_autoreply_users")
    .select("id,telegram_user_id,subscribed_checked_at")
    .eq("bot_id", bot.id).eq("referred_by", userId)
    .or(`subscribed_checked_at.is.null,subscribed_checked_at.lt.${cutoff}`)
    .limit(15);
  for (const row of data || []) {
    const result = await checkSubscription(bot, token, Number(row.telegram_user_id), row.id);
    if (result === null) break;
  }
}

async function invitedStats(botId: string, userId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase.from("bot_autoreply_users")
    .select("subscribed").eq("bot_id", botId).eq("referred_by", userId).limit(10000);
  const invited = data?.length || 0;
  const subscribed = (data || []).filter((row) => row.subscribed === true).length;
  return { invited, subscribed };
}

export async function trafficLeaderboard(botId: string, limit = 10) {
  const supabase = createServiceClient();
  const { data } = await supabase.from("bot_autoreply_users")
    .select("referred_by,subscribed").eq("bot_id", botId).not("referred_by", "is", null).limit(20000);
  const counts = new Map<string, { invited: number; subscribed: number }>();
  for (const row of data || []) {
    const key = String(row.referred_by);
    const entry = counts.get(key) || { invited: 0, subscribed: 0 };
    entry.invited += 1;
    if (row.subscribed) entry.subscribed += 1;
    counts.set(key, entry);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1].subscribed - a[1].subscribed || b[1].invited - a[1].invited)
    .slice(0, limit);
  if (!top.length) return [];
  const { data: users } = await supabase.from("bot_autoreply_users")
    .select("id,first_name,username").in("id", top.map(([id]) => id));
  const byId = new Map((users || []).map((u) => [u.id, u]));
  return top.map(([id, stats]) => ({ userId: id, name: displayName(byId.get(id) || {}), username: byId.get(id)?.username || null, ...stats }));
}

async function activeGiveaway(botId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase.from("traffic_giveaways")
    .select("id,title,prize,description,ends_at").eq("bot_id", botId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

function menu(bot: TrafficBot) {
  return [
    [{ text: "🎁 Розыгрыш", callback_data: "tr:gw" }, { text: "👥 Пригласить друзей", callback_data: "tr:invite" }],
    [{ text: "📊 Моя статистика", callback_data: "tr:me" }, { text: "🏆 Топ", callback_data: "tr:top" }],
    [{ text: "🛒 Магазин GAME OVER", url: DEFAULT_SHOP_URL }],
    [{ text: "📣 Канал GAME OVER", url: channelUrl(bot.traffic_channel) }],
  ];
}

async function sendWelcome(bot: TrafficBot, token: string, user: TrafficUser) {
  const text = (bot.traffic_welcome || "").trim() || DEFAULT_TRAFFIC_WELCOME;
  await send(bot, token, user, text, menu(bot));
}

async function sendInvite(bot: TrafficBot, token: string, user: TrafficUser) {
  if (!bot.telegram_username || !user.ref_code) {
    await send(bot, token, user, "Ссылка пока недоступна, попробуй чуть позже.");
    return;
  }
  const link = refLink(bot.telegram_username, user.ref_code);
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Залетай в GAME OVER: новости PUBG MOBILE и розыгрыши 🎮")}`;
  await send(bot, token, user,
    `👥 Твоя личная ссылка:\n${link}\n\nЗа каждого друга, который перейдёт по ней и подпишется на канал, ты получаешь +1 билет в розыгрыше и поднимаешься в топе.`,
    [[{ text: "📤 Поделиться ссылкой", url: share }], [{ text: "📊 Моя статистика", callback_data: "tr:me" }]]);
}

async function sendMe(bot: TrafficBot, token: string, user: TrafficUser) {
  await refreshInvited(bot, token, user.id);
  const stats = await invitedStats(bot.id, user.id);
  const sub = await checkSubscription(bot, token, user.telegram_user_id, user.id);
  const giveaway = await activeGiveaway(bot.id);
  let entryLine = "Активного розыгрыша сейчас нет.";
  if (giveaway) {
    const supabase = createServiceClient();
    const { data: entry } = await supabase.from("traffic_giveaway_entries")
      .select("id").eq("giveaway_id", giveaway.id).eq("user_id", user.id).maybeSingle();
    entryLine = entry
      ? `Ты участвуешь в «${giveaway.title}». Билетов: ${1 + stats.subscribed}.`
      : `Идёт розыгрыш «${giveaway.title}», ты пока не участвуешь.`;
  }
  const subLine = sub === null ? "Подписка на канал: проверка недоступна" : sub ? "Подписка на канал: ✅" : "Подписка на канал: ❌ не подписан";
  await send(bot, token, user,
    `📊 Твоя статистика\n\nПриглашено друзей: ${stats.invited}\nИз них подписались на канал: ${stats.subscribed}\n${subLine}\n\n${entryLine}`,
    [[{ text: "👥 Пригласить друзей", callback_data: "tr:invite" }, { text: "🏆 Топ", callback_data: "tr:top" }]]);
}

async function sendTop(bot: TrafficBot, token: string, user: TrafficUser) {
  const top = await trafficLeaderboard(bot.id, 10);
  const lines = top.length
    ? top.map((row, i) => `${i + 1}. ${row.name} — ${row.subscribed} подписчиков (${row.invited} приглашено)`).join("\n")
    : "Пока никто никого не пригласил. Стань первым!";
  await send(bot, token, user, `🏆 Топ приглашающих\n\n${lines}`, [[{ text: "👥 Моя ссылка", callback_data: "tr:invite" }]]);
}

async function sendGiveaway(bot: TrafficBot, token: string, user: TrafficUser) {
  const giveaway = await activeGiveaway(bot.id);
  if (!giveaway) {
    await send(bot, token, user, "🎁 Сейчас активного розыгрыша нет. Подпишись на канал, чтобы не пропустить следующий!",
      [[{ text: "📣 Канал GAME OVER", url: channelUrl(bot.traffic_channel) }]]);
    return;
  }
  const ends = giveaway.ends_at ? `\nИтоги: ${new Date(giveaway.ends_at).toLocaleDateString("ru-RU", { timeZone: "Europe/Kyiv" })}` : "";
  const body = [`🎁 ${giveaway.title}`, giveaway.prize ? `Приз: ${giveaway.prize}` : "", giveaway.description || "",
    "Условия: подписка на канал. +1 билет за каждого приглашённого друга, который тоже подписался." + ends]
    .filter(Boolean).join("\n\n");
  await send(bot, token, user, body, [
    [{ text: "✅ Участвовать", callback_data: "tr:join" }],
    [{ text: "📣 Подписаться на канал", url: channelUrl(bot.traffic_channel) }],
    [{ text: "👥 Пригласить друзей", callback_data: "tr:invite" }],
  ]);
}

async function joinGiveaway(bot: TrafficBot, token: string, user: TrafficUser) {
  const giveaway = await activeGiveaway(bot.id);
  if (!giveaway) {
    await send(bot, token, user, "Сейчас активного розыгрыша нет.");
    return;
  }
  const sub = await checkSubscription(bot, token, user.telegram_user_id, user.id);
  if (sub === null) {
    await send(bot, token, user, "Не получилось проверить подписку. Попробуй ещё раз чуть позже.");
    return;
  }
  if (!sub) {
    await send(bot, token, user, "Чтобы участвовать, подпишись на канал и нажми «Проверить ещё раз».", [
      [{ text: "📣 Подписаться на канал", url: channelUrl(bot.traffic_channel) }],
      [{ text: "🔄 Проверить ещё раз", callback_data: "tr:join" }],
    ]);
    return;
  }
  const supabase = createServiceClient();
  await supabase.from("traffic_giveaway_entries").upsert({
    organization_id: bot.organization_id, giveaway_id: giveaway.id, user_id: user.id,
  }, { onConflict: "giveaway_id,user_id", ignoreDuplicates: true });
  await refreshInvited(bot, token, user.id);
  const stats = await invitedStats(bot.id, user.id);
  await send(bot, token, user,
    `✅ Ты в розыгрыше «${giveaway.title}»!\nБилетов: ${1 + stats.subscribed}.\n\nПриглашай друзей по своей ссылке, чтобы получить больше билетов.`,
    [[{ text: "👥 Пригласить друзей", callback_data: "tr:invite" }]]);
}

const HELP = "Команды:\n/start — главное меню\n/giveaway — розыгрыш\n/invite — моя ссылка для друзей\n/me — моя статистика\n/top — топ приглашающих";

async function runAction(bot: TrafficBot, token: string, user: TrafficUser, action: string) {
  if (action === "gw" || action === "giveaway") return sendGiveaway(bot, token, user);
  if (action === "join") return joinGiveaway(bot, token, user);
  if (action === "invite" || action === "ref") return sendInvite(bot, token, user);
  if (action === "me" || action === "stats") return sendMe(bot, token, user);
  if (action === "top") return sendTop(bot, token, user);
  if (action === "help") return send(bot, token, user, HELP, menu(bot));
  return sendWelcome(bot, token, user);
}

/** Handles traffic features. Returns false when the update should fall through to the regular auto-reply engine. */
export async function handleTrafficUpdate(bot: TrafficBot, token: string, update: TrafficUpdate): Promise<boolean> {
  const callback = update.callback_query;
  if (callback?.id && callback.from && !callback.from.is_bot) {
    const chat = callback.message?.chat;
    try { await telegramAnswerCallbackQuery(token, callback.id); } catch { /* ignore */ }
    if (!chat || chat.type !== "private") return true;
    const user = await ensureUser(bot, callback.from, String(chat.id));
    if (!user) return true;
    const action = String(callback.data || "").replace(/^tr:/, "");
    await runAction(bot, token, user, action);
    return true;
  }

  const message = update.message;
  if (!message?.chat || message.chat.type !== "private" || !message.from || message.from.is_bot) return false;
  const text = String(message.text || message.caption || "").trim();
  const start = parseStart(text);
  const cmd = command(text);
  const known = ["start", "giveaway", "invite", "ref", "me", "stats", "top", "help"];
  if (!start && (!cmd || !known.includes(cmd))) {
    if (bot.ai_enabled || bot.operator_mode_enabled || (bot.main_message || "").trim()) return false;
    const user = await ensureUser(bot, message.from, String(message.chat.id));
    if (!user) return true;
    await log(bot, user.id, "in", text, String(message.chat.id), message.message_id);
    await send(bot, token, user, "Выбери, что тебя интересует 👇", menu(bot));
    return true;
  }
  const user = await ensureUser(bot, message.from, String(message.chat.id), start || undefined);
  if (!user) return true;
  await log(bot, user.id, "in", text, String(message.chat.id), message.message_id);
  if (start) {
    if (user.isNew) await checkSubscription(bot, token, user.telegram_user_id, user.id);
    await sendWelcome(bot, token, user);
    return true;
  }
  await runAction(bot, token, user, cmd || "start");
  return true;
}

export { DEFAULT_CHANNEL_URL };
