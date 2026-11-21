import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { generateWithFallback } from "@/lib/ai/fallback";
import { autoReplySystemPrompt } from "@/lib/bot-replies/prompt";
import { telegramForwardMessage, telegramSendMessage } from "@/lib/bot-replies/telegram";

type BotRow = {
  id: string;
  organization_id: string;
  enabled: boolean;
  main_message: string;
  ai_enabled: boolean;
  prompt_id: string | null;
  knowledge_base: string;
  reply_limit_per_user: number | null;
  operator_mode_enabled: boolean;
  operator_chat_id: string | null;
};

type TgMessage = {
  message_id: number;
  date?: number;
  text?: string;
  caption?: string;
  from?: {
    id: number;
    is_bot?: boolean;
    username?: string;
    first_name?: string;
    last_name?: string;
    language_code?: string;
  };
  chat?: { id: number; type?: string };
  reply_to_message?: { message_id: number };
};

function messageText(message: TgMessage) {
  return String(message.text || message.caption || "").trim();
}

async function upsertUser(bot: BotRow, message: TgMessage) {
  const supabase = createServiceClient();
  const from = message.from;
  const chatId = String(message.chat?.id ?? from?.id ?? "");
  if (!from?.id || !chatId) return null;
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from("bot_autoreply_users")
    .select("id,reply_count")
    .eq("bot_id", bot.id)
    .eq("telegram_user_id", from.id)
    .maybeSingle();
  if (existing) {
    await supabase.from("bot_autoreply_users").update({
      telegram_chat_id: chatId,
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      language_code: from.language_code || null,
      last_seen_at: now,
    }).eq("id", existing.id);
    return existing;
  }
  const { data, error } = await supabase.from("bot_autoreply_users").insert({
    organization_id: bot.organization_id,
    bot_id: bot.id,
    telegram_user_id: from.id,
    telegram_chat_id: chatId,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    language_code: from.language_code || null,
    reply_count: 0,
    first_seen_at: now,
    last_seen_at: now,
  }).select("id,reply_count").maybeSingle();
  if (error || !data) return null;
  return data;
}

async function logMessage(bot: BotRow, userId: string, fields: Record<string, unknown>) {
  const supabase = createServiceClient();
  const { data } = await supabase.from("bot_autoreply_messages").insert({
    organization_id: bot.organization_id,
    bot_id: bot.id,
    user_id: userId,
    body: String(fields.body || "").slice(0, 8192),
    direction: fields.direction,
    source: fields.source,
    telegram_message_id: fields.telegram_message_id ?? null,
    telegram_chat_id: fields.telegram_chat_id ?? null,
    operator_forward_message_id: fields.operator_forward_message_id ?? null,
  }).select("id").maybeSingle();
  return data;
}

async function bumpReplyCount(userId: string, current: number) {
  const supabase = createServiceClient();
  await supabase.from("bot_autoreply_users").update({ reply_count: current + 1 }).eq("id", userId);
}

async function handleOperatorReply(bot: BotRow, token: string, message: TgMessage) {
  const replyTo = message.reply_to_message?.message_id;
  const text = messageText(message);
  if (!replyTo || !text) return;
  const supabase = createServiceClient();
  const { data: mapped } = await supabase.from("bot_autoreply_messages")
    .select("id,user_id")
    .eq("bot_id", bot.id)
    .eq("operator_forward_message_id", replyTo)
    .maybeSingle();
  if (!mapped) return;
  const { data: user } = await supabase.from("bot_autoreply_users")
    .select("id,telegram_chat_id")
    .eq("id", mapped.user_id)
    .maybeSingle();
  if (!user?.telegram_chat_id) return;
  const sent = await telegramSendMessage(token, user.telegram_chat_id, text);
  await logMessage(bot, user.id, {
    direction: "out",
    source: "operator",
    body: text,
    telegram_message_id: sent?.message_id ?? null,
    telegram_chat_id: user.telegram_chat_id,
  });
}

async function notifyOperator(bot: BotRow, token: string, userId: string, message: TgMessage, text: string) {
  if (!bot.operator_mode_enabled || !bot.operator_chat_id) return;
  const from = message.from;
  const label = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || "Пользователь";
  const uname = from?.username ? `@${from.username}` : `id ${from?.id}`;
  let forwardId: number | null = null;
  try {
    const forwarded = await telegramForwardMessage(token, bot.operator_chat_id, message.chat?.id ?? "", message.message_id);
    forwardId = forwarded?.message_id ?? null;
  } catch {
    const sent = await telegramSendMessage(
      token,
      bot.operator_chat_id,
      `Сообщение от ${label} (${uname}):\n\n${text || "[без текста]"}`,
    );
    forwardId = sent?.message_id ?? null;
  }
  if (forwardId) {
    const supabase = createServiceClient();
    await supabase.from("bot_autoreply_messages")
      .update({ operator_forward_message_id: forwardId })
      .eq("bot_id", bot.id)
      .eq("user_id", userId)
      .eq("telegram_message_id", message.message_id)
      .eq("direction", "in");
  }
}

export async function handleBotUpdate(bot: BotRow, token: string, update: { message?: TgMessage }) {
  const message = update.message;
  if (!message?.message_id || !message.chat) return;
  if (message.from?.is_bot) return;

  const operatorChat = bot.operator_chat_id && String(message.chat.id) === String(bot.operator_chat_id);
  if (operatorChat) {
    if (bot.operator_mode_enabled) await handleOperatorReply(bot, token, message);
    return;
  }

  const user = await upsertUser(bot, message);
  if (!user) return;
  const text = messageText(message);
  await logMessage(bot, user.id, {
    direction: "in",
    source: "user",
    body: text || "[без текста]",
    telegram_message_id: message.message_id,
    telegram_chat_id: String(message.chat.id),
  });

  if (bot.operator_mode_enabled) {
    try { await notifyOperator(bot, token, user.id, message, text); }
    catch { /* operator notify must not block auto-reply */ }
  }

  const isStart = /^\/start(?:@\w+)?(?:\s|$)/i.test(text);
  const limited = bot.reply_limit_per_user != null && user.reply_count >= bot.reply_limit_per_user;
  if (limited && !isStart) return;

  let replies = user.reply_count;
  if (isStart && bot.main_message.trim()) {
    const sent = await telegramSendMessage(token, message.chat.id, bot.main_message);
    await logMessage(bot, user.id, {
      direction: "out",
      source: "start",
      body: bot.main_message,
      telegram_message_id: sent?.message_id ?? null,
      telegram_chat_id: String(message.chat.id),
    });
    await bumpReplyCount(user.id, replies);
    replies += 1;
    return;
  }

  if (bot.ai_enabled && text && !isStart) {
    if (bot.reply_limit_per_user != null && replies >= bot.reply_limit_per_user) return;
    let promptText = "";
    if (bot.prompt_id) {
      const supabase = createServiceClient();
      const { data: saved } = await supabase.from("user_prompts")
        .select("prompt_text").eq("id", bot.prompt_id).eq("organization_id", bot.organization_id).maybeSingle();
      promptText = saved?.prompt_text || "";
    }
    try {
      const generated = await generateWithFallback(
        bot.organization_id,
        autoReplySystemPrompt(promptText, bot.knowledge_base || ""),
        text,
      );
      const sent = await telegramSendMessage(token, message.chat.id, generated.text);
      await logMessage(bot, user.id, {
        direction: "out",
        source: "ai",
        body: generated.text,
        telegram_message_id: sent?.message_id ?? null,
        telegram_chat_id: String(message.chat.id),
      });
      await bumpReplyCount(user.id, replies);
    } catch {
      // Leave the inbound message stored; do not fail the webhook.
    }
    return;
  }

  if (!isStart && bot.main_message.trim() && !bot.ai_enabled) {
    if (bot.reply_limit_per_user != null && replies >= bot.reply_limit_per_user) return;
    const sent = await telegramSendMessage(token, message.chat.id, bot.main_message);
    await logMessage(bot, user.id, {
      direction: "out",
      source: "main",
      body: bot.main_message,
      telegram_message_id: sent?.message_id ?? null,
      telegram_chat_id: String(message.chat.id),
    });
    await bumpReplyCount(user.id, replies);
  }
}
