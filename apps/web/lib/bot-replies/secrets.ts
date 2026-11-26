import "server-only";

import { randomBytes } from "node:crypto";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "@/lib/integrations/crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { WEBHOOK_SECRET_BYTES, webhookUrl } from "@/lib/bot-replies/constants";
import { isBlockedBotUsername } from "@/lib/bot-replies/constants";
import {
  telegramDeleteWebhook, telegramGetMe, telegramGetWebhookInfo, telegramSetWebhook,
} from "@/lib/bot-replies/telegram";

const PROVIDER = "bot_autoreply";

export function newWebhookSecret() {
  return randomBytes(WEBHOOK_SECRET_BYTES).toString("hex");
}

export async function storeBotToken(botId: string, organizationId: string, token: string, webhookSecret: string) {
  const packed = encryptIntegrationSecret(token, organizationId, PROVIDER);
  const supabase = createServiceClient();
  const { error } = await supabase.from("bot_autoreply_secrets").upsert({
    bot_id: botId,
    organization_id: organizationId,
    nonce: packed.nonce,
    ciphertext: packed.ciphertext,
    webhook_secret: webhookSecret,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("Не удалось сохранить токен бота.");
}

export async function loadBotSecret(botId: string, organizationId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("bot_autoreply_secrets")
    .select("nonce,ciphertext,webhook_secret")
    .eq("bot_id", botId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  const token = decryptIntegrationSecret(data.nonce, data.ciphertext, organizationId, PROVIDER);
  return { token, webhookSecret: data.webhook_secret as string };
}

export async function inspectToken(token: string) {
  const me = await telegramGetMe(token);
  if (!me?.is_bot || !me.id) throw new Error("Это не токен Telegram-бота.");
  if (isBlockedBotUsername(me.username)) {
    throw new Error("Этот бот нельзя подключить: он уже используется как живой магазин и не должен получать автоответы.");
  }
  return me;
}

export async function assertWebhookAvailable(token: string, botId: string, webhookSecret: string) {
  const info = await telegramGetWebhookInfo(token);
  const ours = webhookUrl(botId, webhookSecret);
  const current = (info?.url || "").trim();
  if (current && current !== ours) {
    throw new Error("У этого бота уже установлен webhook. Подключение прервано, чтобы не перехватить чужие обновления.");
  }
  return ours;
}

export async function enableBotWebhook(botId: string, organizationId: string) {
  const secret = await loadBotSecret(botId, organizationId);
  if (!secret) throw new Error("Токен бота не найден.");
  await inspectToken(secret.token);
  const url = await assertWebhookAvailable(secret.token, botId, secret.webhookSecret);
  await telegramSetWebhook(secret.token, url, secret.webhookSecret);
}

export async function disableBotWebhook(botId: string, organizationId: string) {
  const secret = await loadBotSecret(botId, organizationId);
  if (!secret) return;
  try {
    const info = await telegramGetWebhookInfo(secret.token);
    const ours = webhookUrl(botId, secret.webhookSecret);
    if (!info?.url || info.url === ours) {
      await telegramDeleteWebhook(secret.token);
    }
  } catch {
    // Do not leak token failures; the row can still be disabled locally.
  }
}
