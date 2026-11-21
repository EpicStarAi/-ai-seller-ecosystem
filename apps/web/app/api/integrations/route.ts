import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { verifyProvider, type IntegrationProvider } from "@/lib/integrations/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedProviders = new Set<IntegrationProvider>(["telegram", "openai", "anthropic", "gemini"]);

async function authenticatedUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  return { supabase, user };
}

async function authorizeOrganization(supabase: any, userId: string, organizationId: string, adminOnly: boolean) {
  const { data, error } = await supabase.from("memberships")
    .select("role").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
  if (error || !data) return { error: "Нет доступа к этому рабочему пространству.", status: 403 };
  if (adminOnly && !["owner", "admin"].includes(data.role)) {
    return { error: "Для управления интеграциями нужны права владельца или администратора.", status: 403 };
  }
  return { role: data.role };
}

export async function GET(request: Request) {
  const auth = await authenticatedUser();
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "Не указан organizationId." }, { status: 400 });
  const access = await authorizeOrganization(supabase, user.id, organizationId, false);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const { data, error } = await supabase.from("integrations")
    .select("id,kind,label,status,external_account_id,metadata,last_tested_at,created_at")
    .eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Не удалось загрузить интеграции." }, { status: 500 });
  return NextResponse.json({ integrations: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticatedUser();
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;

  let body: { provider?: string; secret?: string; label?: string; organizationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 });
  }
  const provider = body.provider as IntegrationProvider;
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  const organizationId = body.organizationId ?? "";
  if (!allowedProviders.has(provider)) return NextResponse.json({ error: "Провайдер не поддерживается." }, { status: 400 });
  if (secret.length < 12 || secret.length > 8192) return NextResponse.json({ error: "Проверьте длину ключа или токена." }, { status: 422 });
  if (!organizationId) return NextResponse.json({ error: "Не указано рабочее пространство." }, { status: 400 });

  const access = await authorizeOrganization(supabase, user.id, organizationId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  let verified;
  try {
    verified = await verifyProvider(provider, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Проверка провайдера не прошла.";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  let encryption;
  try {
    encryption = encryptIntegrationSecret(secret, organizationId, provider);
  } catch {
    return NextResponse.json({ error: "Серверное хранилище ключей не настроено." }, { status: 503 });
  }

  // Telegram supports multiple bot identities per organization.
  const existingQuery = supabase.from("integrations").select("id")
    .eq("organization_id", organizationId).eq("kind", provider);
  const { data: existing } = provider === "telegram"
    ? await existingQuery.eq("external_account_id", verified.externalAccountId).maybeSingle()
    : await existingQuery.limit(1).maybeSingle();
  const secretId = randomUUID();
  let integrationId = existing?.id as string | undefined;

  if (integrationId) {
    const { error: secretError } = await supabase.from("integration_secrets").upsert({
      id: secretId,
      organization_id: organizationId,
      integration_id: integrationId,
      nonce: encryption.nonce,
      ciphertext: encryption.ciphertext,
      key_version: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "integration_id" });
    if (secretError) return NextResponse.json({ error: "Не удалось сохранить credential." }, { status: 500 });
    const { error: updateError } = await supabase.from("integrations").update({
      external_account_id: verified.externalAccountId,
      secret_ref: secretId,
      status: "connected",
      label: (body.label?.trim() || verified.label).slice(0, 120),
      metadata: verified.metadata,
      last_tested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", integrationId).eq("organization_id", organizationId);
    if (updateError) return NextResponse.json({ error: "Credential сохранён, но метаданные интеграции не обновились." }, { status: 500 });
  } else {
    integrationId = randomUUID();
    const { error: insertError } = await supabase.from("integrations").insert({
      id: integrationId,
      organization_id: organizationId,
      kind: provider,
      external_account_id: verified.externalAccountId,
      secret_ref: secretId,
      status: "connected",
      label: (body.label?.trim() || verified.label).slice(0, 120),
      metadata: verified.metadata,
      last_tested_at: new Date().toISOString(),
    });
    if (insertError) return NextResponse.json({ error: "Не удалось создать интеграцию." }, { status: 500 });
    const { error: secretError } = await supabase.from("integration_secrets").insert({
      id: secretId,
      organization_id: organizationId,
      integration_id: integrationId,
      nonce: encryption.nonce,
      ciphertext: encryption.ciphertext,
      key_version: 1,
    });
    if (secretError) {
      await supabase.from("integrations").delete().eq("id", integrationId).eq("organization_id", organizationId);
      return NextResponse.json({ error: "Не удалось сохранить credential." }, { status: 500 });
    }
  }

  const { data: saved, error: readError } = await supabase.from("integrations")
    .select("id,kind,label,status,external_account_id,metadata,last_tested_at,created_at")
    .eq("id", integrationId).single();
  if (readError || !saved) return NextResponse.json({ error: "Интеграция сохранена, но не удалось обновить список." }, { status: 500 });
  return NextResponse.json({ integration: saved });
}
