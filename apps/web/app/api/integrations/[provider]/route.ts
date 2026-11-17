import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";
import { IntegrationProvider, verifyProvider } from "@/lib/integrations/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedProviders = new Set<IntegrationProvider>(["telegram", "openai", "anthropic", "gemini"]);

async function loadContext(request: Request, provider: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  if (!allowedProviders.has(provider as IntegrationProvider)) {
    return { response: NextResponse.json({ error: "Провайдер не поддерживается." }, { status: 404 }) };
  }
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships")
    .select("role").eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership) return { response: NextResponse.json({ error: "Нет доступа к рабочему пространству." }, { status: 403 }) };
  return { supabase, user, organizationId, role: membership.role };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const ctx = await loadContext(request, provider);
  if ("response" in ctx) return ctx.response;
  const { supabase, organizationId } = ctx;

  const { data: integration, error: integrationError } = await supabase.from("integrations")
    .select("id,kind").eq("organization_id", organizationId).eq("kind", provider).single();
  if (integrationError || !integration) return NextResponse.json({ error: "Интеграция не подключена." }, { status: 404 });

  const { data: stored, error: secretError } = await supabase.from("integration_secrets")
    .select("nonce,ciphertext").eq("integration_id", integration.id).single();
  if (secretError || !stored) return NextResponse.json({ error: "Credential не найден." }, { status: 404 });

  let secret: string;
  try {
    secret = decryptIntegrationSecret(stored.nonce, stored.ciphertext, organizationId, provider);
  } catch {
    return NextResponse.json({ error: "Не удалось расшифровать credential. Проверьте ключ шифрования сервера." }, { status: 500 });
  }

  try {
    const verified = await verifyProvider(provider as IntegrationProvider, secret);
    const { data, error } = await supabase.from("integrations").update({
      status: "connected",
      metadata: verified.metadata,
      last_tested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", integration.id).select("id,kind,label,status,external_account_id,metadata,last_tested_at,created_at").single();
    if (error) return NextResponse.json({ error: "Проверка прошла, но статус не обновился." }, { status: 500 });
    return NextResponse.json({ integration: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Проверка подключения не прошла.";
    await supabase.from("integrations").update({ status: "error", updated_at: new Date().toISOString() })
      .eq("id", integration.id);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const ctx = await loadContext(request, provider);
  if ("response" in ctx) return ctx.response;
  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "Нужны права владельца или администратора." }, { status: 403 });
  }
  const { error } = await ctx.supabase.from("integrations").delete()
    .eq("organization_id", ctx.organizationId).eq("kind", provider);
  if (error) return NextResponse.json({ error: "Не удалось отключить интеграцию." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
