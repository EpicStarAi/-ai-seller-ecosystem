import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatProvider = "openai" | "anthropic" | "gemini";
type ChatMessage = { role: "user" | "assistant"; content: string };

const models: Record<ChatProvider, string> = {
  openai: "gpt-6-astra",
  anthropic: "claude-sonnet-5-5",
  gemini: "gemini-3.8-flash",
};

function extractProviderError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const error = root.error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
    return (error as Record<string, string>).message;
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });

  let body: { provider?: string; organizationId?: string; messages?: ChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 });
  }

  const provider = body.provider as ChatProvider;
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  if (!["openai", "anthropic", "gemini"].includes(provider)) {
    return NextResponse.json({ error: "Выбранный AI-провайдер не поддерживается." }, { status: 400 });
  }
  if (!organizationId) return NextResponse.json({ error: "Не указано рабочее пространство." }, { status: 400 });

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length || messages.length > 20) {
    return NextResponse.json({ error: "Передайте от 1 до 20 сообщений." }, { status: 422 });
  }
  const safeMessages: ChatMessage[] = [];
  for (const item of messages) {
    if (!item || (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" || !item.content.trim() || item.content.length > 12000) {
      return NextResponse.json({ error: "Некорректный формат истории сообщений." }, { status: 422 });
    }
    safeMessages.push({ role: item.role, content: item.content.trim() });
  }
  if (safeMessages[safeMessages.length - 1]?.role !== "user") {
    return NextResponse.json({ error: "Последнее сообщение должно быть от пользователя." }, { status: 422 });
  }

  const { data: membership, error: membershipError } = await supabase.from("memberships")
    .select("role").eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (membershipError || !membership) {
    return NextResponse.json({ error: "Нет доступа к этому рабочему пространству." }, { status: 403 });
  }

  const { data: integration, error: integrationError } = await supabase.from("integrations")
    .select("id,status").eq("organization_id", organizationId).eq("kind", provider).maybeSingle();
  if (integrationError || !integration || integration.status !== "connected") {
    return NextResponse.json({ error: "Сначала подключите и проверьте выбранного AI-провайдера в разделе «Интеграции»." }, { status: 409 });
  }

  const { data: stored, error: secretError } = await supabase.from("integration_secrets")
    .select("nonce,ciphertext").eq("organization_id", organizationId).eq("integration_id", integration.id).maybeSingle();
  if (secretError || !stored) {
    return NextResponse.json({ error: "Сохранённый credential не найден. Переподключите провайдера." }, { status: 409 });
  }

  let secret: string;
  try {
    secret = decryptIntegrationSecret(stored.nonce, stored.ciphertext, organizationId, provider);
  } catch {
    return NextResponse.json({ error: "Не удалось расшифровать credential. Проверьте серверный ключ шифрования." }, { status: 500 });
  }

  const model = models[provider];
  let endpoint: string;
  let headers: Record<string, string>;
  let payload: Record<string, unknown>;

  if (provider === "openai") {
    endpoint = "https://api.openai.com/v1/responses";
    headers = { Authorization: `Bearer ${secret}` };
    payload = {
      model,
      input: safeMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      max_output_tokens: 1600,
    };
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = { "x-api-key": secret, "anthropic-version": "2026-10-21" };
    payload = {
      model,
      max_tokens: 1600,
      messages: safeMessages.map(({ role, content }) => ({ role, content })),
    };
  } else {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers = { "x-goog-api-key": secret };
    payload = {
      contents: safeMessages.map(({ role, content }) => ({
        role: role === "assistant" ? "model" : "user",
        parts: [{ text: content }],
      })),
      generationConfig: { maxOutputTokens: 1600 },
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const providerMessage = extractProviderError(result);
      const status = response.status === 429 ? 429 : 502;
      return NextResponse.json({
        error: response.status === 429
          ? "Лимит запросов провайдера достигнут. Проверьте квоту или биллинг."
          : providerMessage
            ? `Провайдер отклонил запрос: ${providerMessage.slice(0, 300)}`
            : "AI-провайдер не смог обработать запрос. Проверьте модель, ключ и доступ к API.",
      }, { status });
    }

    let answer = "";
    if (provider === "openai") {
      if (typeof result.output_text === "string") answer = result.output_text;
      else if (Array.isArray(result.output)) {
        answer = result.output.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const content = (item as Record<string, unknown>).content;
          return Array.isArray(content) ? content.flatMap((part) =>
            part && typeof part === "object" && (part as Record<string, unknown>).type === "output_text" &&
            typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, string>).text] : []) : [];
        }).join("\n");
      }
    } else if (provider === "anthropic") {
      const content = result.content;
      if (Array.isArray(content)) answer = content.flatMap((part) =>
        part && typeof part === "object" && (part as Record<string, unknown>).type === "text" &&
        typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, string>).text] : []).join("\n");
    } else {
      const candidates = result.candidates;
      if (Array.isArray(candidates) && candidates[0] && typeof candidates[0] === "object") {
        const content = (candidates[0] as Record<string, unknown>).content;
        if (content && typeof content === "object" && Array.isArray((content as Record<string, unknown>).parts)) {
          answer = ((content as Record<string, unknown>).parts as unknown[]).flatMap((part) =>
            part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
              ? [(part as Record<string, string>).text] : []).join("\n");
        }
      }
    }

    if (!answer.trim()) return NextResponse.json({ error: "Провайдер вернул пустой ответ." }, { status: 502 });
    return NextResponse.json({ answer, provider, model });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json({
      error: timedOut ? "Превышено время ожидания ответа AI-провайдера." : "Не удалось связаться с AI-провайдером.",
    }, { status: 502 });
  }
}
