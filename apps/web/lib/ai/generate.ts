export type ChatProvider = "ollama" | "openai" | "anthropic" | "gemini";

export const defaultModels: Record<ChatProvider, string> = {
  ollama: process.env.OLLAMA_MODEL || "qwen3.5:9b",
  openai: "gpt-6-astra",
  anthropic: "claude-sonnet-5-5",
  gemini: "gemini-3.8-flash",
};

type ChatMessage = { role: "user" | "assistant" | "system" | "developer"; content: string };

function extractProviderError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as Record<string, unknown>).error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
    return (error as Record<string, string>).message;
  }
  return null;
}

function parseAnswer(provider: ChatProvider, result: Record<string, unknown>): string {
  if (provider === "ollama") {
    const message = result.message;
    if (message && typeof message === "object" && typeof (message as Record<string, unknown>).content === "string") {
      return (message as Record<string, string>).content;
    }
  } else if (provider === "openai") {
    if (typeof result.output_text === "string") return result.output_text;
    if (Array.isArray(result.output)) {
      return result.output.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const content = (item as Record<string, unknown>).content;
        return Array.isArray(content) ? content.flatMap((part) =>
          part && typeof part === "object" && (part as Record<string, unknown>).type === "output_text" &&
          typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, string>).text] : []) : [];
      }).join("\n");
    }
  } else if (provider === "anthropic") {
    const content = result.content;
    if (Array.isArray(content)) {
      return content.flatMap((part) =>
        part && typeof part === "object" && (part as Record<string, unknown>).type === "text" &&
        typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, string>).text] : []).join("\n");
    }
  } else {
    const candidates = result.candidates;
    if (Array.isArray(candidates) && candidates[0] && typeof candidates[0] === "object") {
      const content = (candidates[0] as Record<string, unknown>).content;
      if (content && typeof content === "object" && Array.isArray((content as Record<string, unknown>).parts)) {
        return ((content as Record<string, unknown>).parts as unknown[]).flatMap((part) =>
          part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
            ? [(part as Record<string, string>).text] : []).join("\n");
      }
    }
  }
  return "";
}

export async function generateText(options: {
  provider: ChatProvider;
  secret?: string;
  model?: string;
  systemPrompt: string;
  userText: string;
}): Promise<{ text: string; provider: ChatProvider; model: string }> {
  const provider = options.provider;
  const model = options.model || defaultModels[provider];
  const systemPrompt = options.systemPrompt.slice(0, 12000);
  const userText = options.userText.slice(0, 20000);
  let endpoint: string;
  let headers: Record<string, string> = {};
  let payload: Record<string, unknown>;

  if (provider === "ollama") {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11435";
    endpoint = `${ollamaBaseUrl.replace(/\/+$/, "")}/api/chat`;
    payload = {
      model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: userText },
      ],
      stream: false,
      think: false,
      options: { num_predict: 1600, num_ctx: 8192 },
    };
  } else if (provider === "openai") {
    if (!options.secret) throw new Error("Отсутствует ключ OpenAI.");
    endpoint = "https://api.openai.com/v1/responses";
    headers = { Authorization: `Bearer ${options.secret}` };
    const input: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "developer" as const, content: systemPrompt }] : []),
      { role: "user", content: userText },
    ];
    payload = { model, input, max_output_tokens: 1600 };
  } else if (provider === "anthropic") {
    if (!options.secret) throw new Error("Отсутствует ключ Anthropic.");
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = { "x-api-key": options.secret, "anthropic-version": "2026-10-21" };
    payload = {
      model,
      max_tokens: 1600,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: userText }],
    };
  } else {
    if (!options.secret) throw new Error("Отсутствует ключ Gemini.");
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { "x-goog-api-key": options.secret };
    payload = {
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: 1600 },
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(provider === "ollama" ? 180000 : 60000),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const providerMessage = extractProviderError(result);
    const err = new Error(providerMessage
      ? `Провайдер отклонил запрос: ${providerMessage.slice(0, 300)}`
      : `AI-провайдер вернул HTTP ${response.status}`);
    (err as Error & { status?: number }).status = response.status === 429 ? 429 : 502;
    throw err;
  }
  const text = parseAnswer(provider, result).trim();
  if (!text) throw new Error("Провайдер вернул пустой ответ.");
  return { text: text.slice(0, 4000), provider, model };
}

export function rewriteSystemPrompt(flowPrompt: string): string {
  return [
    "Ты редактор Telegram-канала с новостями. Перепиши исходный пост донора по инструкции канала ниже.",
    "Верни только готовый текст публикации, без предисловия и без кавычек вокруг всего текста.",
    "Не выдумывай факты. Сохрани важные имена, даты, цифры и ссылки.",
    "Не добавляй рекламу, магазины UC, промокоды и розыгрыши.",
    "Текст должен подходить для Telegram (обычный текст, до 3500 символов).",
    "",
    "Инструкция канала:",
    (flowPrompt || "").trim() || "Пиши коротко, ясно и по-русски, в стиле новостного канала.",
  ].join("\n");
}
