import "server-only";

import { decryptIntegrationSecret } from "@/lib/integrations/crypto";
import { generateText, type ChatProvider, defaultModels } from "@/lib/ai/generate";
import { createServiceClient } from "@/lib/supabase/service";

const ORDER: ChatProvider[] = ["openai", "anthropic", "gemini", "ollama"];

export async function loadChatProviders(organizationId: string) {
  const supabase = createServiceClient();
  const { data: integrations } = await supabase.from("integrations")
    .select("id,kind").eq("organization_id", organizationId).eq("status", "connected")
    .in("kind", ["openai", "anthropic", "gemini"]);
  const providers: { provider: ChatProvider; secret?: string; model: string }[] = [];
  for (const kind of ["openai", "anthropic", "gemini"] as ChatProvider[]) {
    const chosen = (integrations || []).find((row) => row.kind === kind);
    if (!chosen) continue;
    const { data: secret } = await supabase.from("integration_secrets")
      .select("nonce,ciphertext").eq("integration_id", chosen.id).maybeSingle();
    if (!secret) continue;
    try {
      providers.push({
        provider: kind,
        secret: decryptIntegrationSecret(secret.nonce, secret.ciphertext, organizationId, kind),
        model: defaultModels[kind],
      });
    } catch {
      continue;
    }
  }
  providers.push({ provider: "ollama", model: defaultModels.ollama });
  return providers;
}

export async function generateWithFallback(organizationId: string, systemPrompt: string, userText: string) {
  const providers = await loadChatProviders(organizationId);
  let lastError = "Не удалось получить ответ модели.";
  for (const cfg of providers) {
    try {
      return await generateText({
        provider: cfg.provider,
        secret: cfg.secret,
        model: cfg.model,
        systemPrompt,
        userText,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}
