import "server-only";

export function looksLikeBotToken(value: string) {
  return /^\d{8,}:[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

export class TelegramApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export async function telegramCall<T>(token: string, method: string, payload?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  let result: { ok?: boolean; description?: string; result?: T } = {};
  try {
    result = await response.json() as { ok?: boolean; description?: string; result?: T };
  } catch {
    throw new TelegramApiError("Telegram API returned an unreadable response.", response.status);
  }
  if (!response.ok || !result.ok) {
    throw new TelegramApiError("Telegram API request failed.", response.status);
  }
  return result.result as T;
}

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type WebhookInfo = { url?: string; has_custom_certificate?: boolean };

export async function telegramGetMe(token: string) {
  return telegramCall<TelegramUser>(token, "getMe");
}

export async function telegramGetWebhookInfo(token: string) {
  return telegramCall<WebhookInfo>(token, "getWebhookInfo");
}

export async function telegramSetWebhook(token: string, url: string, secretToken: string) {
  return telegramCall(token, "setWebhook", {
    url,
    secret_token: secretToken,
    drop_pending_updates: true,
    allowed_updates: ["message"],
  });
}

export async function telegramDeleteWebhook(token: string) {
  return telegramCall(token, "deleteWebhook", { drop_pending_updates: false });
}

export async function telegramSendMessage(token: string, chatId: string | number, text: string, extra?: Record<string, unknown>) {
  return telegramCall<{ message_id: number; chat?: { id: number } }>(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4096),
    ...extra,
  });
}

export async function telegramForwardMessage(token: string, toChatId: string | number, fromChatId: string | number, messageId: number) {
  return telegramCall<{ message_id: number }>(token, "forwardMessage", {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  });
}
