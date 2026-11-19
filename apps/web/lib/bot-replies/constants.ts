export const BLOCKED_BOT_USERNAMES = new Set(["gameover_tg_bot"]);

export const MAIN_MESSAGE_LIMIT = 4096;
export const KNOWLEDGE_WORD_LIMIT = 13000;
export const KNOWLEDGE_CHAR_LIMIT = 200000;
export const NAME_LIMIT = 120;
export const WEBHOOK_SECRET_BYTES = 32;

export function isBlockedBotUsername(username: string | null | undefined) {
  return Boolean(username && BLOCKED_BOT_USERNAMES.has(username.replace(/^@/, "").trim().toLowerCase()));
}

export function wordCount(text: string) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function publicBaseUrl() {
  return (process.env.BOT_AUTOREPLY_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://seller.puseta.website").replace(/\/+$/, "");
}

export function webhookUrl(botId: string, secret: string) {
  return `${publicBaseUrl()}/api/bot-replies/hook/${botId}/${secret}`;
}

export const PUBLIC_BOT_COLUMNS = "id,organization_id,name,telegram_bot_id,telegram_username,enabled,main_message,ai_enabled,prompt_id,knowledge_base,reply_limit_per_user,operator_mode_enabled,operator_chat_id,created_at,updated_at";
