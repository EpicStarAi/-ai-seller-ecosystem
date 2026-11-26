import "server-only";

export type IntegrationProvider = "telegram" | "openai" | "anthropic" | "gemini";

export type ProviderVerification = {
  externalAccountId: string | null;
  label: string;
  metadata: Record<string, unknown>;
};

export async function verifyProvider(
  provider: IntegrationProvider,
  secret: string,
): Promise<ProviderVerification> {
  let url: string;
  const headers: Record<string, string> = {};
  const params = new URLSearchParams();

  switch (provider) {
    case "telegram":
      if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(secret)) {
        throw new Error("Формат токена Telegram-бота некорректен.");
      }
      url = `https://api.telegram.org/bot${secret}/getMe`;
      break;
    case "openai":
      url = "https://api.openai.com/v1/models";
      headers.Authorization = `Bearer ${secret}`;
      break;
    case "anthropic":
      url = "https://api.anthropic.com/v1/models";
      headers["x-api-key"] = secret;
      headers["anthropic-version"] = "2026-10-21";
      params.set("limit", "100");
      break;
    case "gemini":
      url = "https://generativelanguage.googleapis.com/v1beta/models";
      headers["x-goog-api-key"] = secret;
      params.set("pageSize", "100");
      break;
  }

  const requestUrl = params.size ? `${url}?${params.toString()}` : url;
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw new Error("Внешний сервис временно недоступен.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Сервис отклонил ключ или токен. Проверьте credential и права доступа.");
  }
  if (!response.ok) throw new Error("Не удалось проверить подключение у провайдера.");

  const payload = await response.json() as Record<string, any>;
  if (provider === "telegram") {
    const bot = payload.result ?? {};
    if (!payload.ok || !bot.id) throw new Error("Telegram не подтвердил токен бота.");
    return {
      externalAccountId: String(bot.id),
      label: bot.username ? `@${bot.username}` : (bot.first_name ?? "Telegram bot"),
      metadata: { username: bot.username ?? null, bot: true },
    };
  }
  if (provider === "openai") {
    return {
      externalAccountId: null,
      label: "OpenAI API",
      metadata: { modelsAvailable: Array.isArray(payload.data) ? payload.data.length : 0 },
    };
  }
  if (provider === "anthropic") {
    return {
      externalAccountId: null,
      label: "Anthropic Claude",
      metadata: { modelsAvailable: Array.isArray(payload.data) ? payload.data.length : 0 },
    };
  }
  return {
    externalAccountId: null,
    label: "Google Gemini",
    metadata: { modelsAvailable: Array.isArray(payload.models) ? payload.models.length : 0 },
  };
}
