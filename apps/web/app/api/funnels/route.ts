import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(organizationId: string, write = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (write && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав для управления воронками." }, { status: 403 }) };
  }
  return { supabase, user };
}

const allowedTypes = new Set(["trigger", "message", "delay", "condition", "ai_response", "action", "end"]);

function normalizeDefinition(input: any) {
  if (!input || typeof input !== "object" || !Array.isArray(input.steps) || input.steps.length > 40) return null;
  const steps = input.steps.map((step: any, index: number) => {
    if (!step || typeof step !== "object" || !allowedTypes.has(step.type)) return null;
    return {
      id: typeof step.id === "string" ? step.id.slice(0, 80) : String(index + 1),
      type: step.type,
      title: typeof step.title === "string" ? step.title.trim().slice(0, 120) : "",
      message: typeof step.message === "string" ? step.message.slice(0, 6000) : "",
      delaySeconds: Number.isInteger(step.delaySeconds) ? Math.max(0, Math.min(step.delaySeconds, 2592000)) : 0,
      buttons: Array.isArray(step.buttons) ? step.buttons.slice(0, 10).map((b: any) => ({
        text: typeof b?.text === "string" ? b.text.trim().slice(0, 64) : "",
        url: typeof b?.url === "string" ? b.url.trim().slice(0, 500) : "",
      })) : [],
      condition: typeof step.condition === "string" ? step.condition.slice(0, 1000) : "",
    };
  });
  if (steps.some((step: any) => !step)) return null;
  return {
    steps,
    settings: {
      loopEnabled: input.settings?.loopEnabled === true,
      defaultReply: typeof input.settings?.defaultReply === "string" ? input.settings.defaultReply.slice(0, 2000) : "",
      consentRequired: input.settings?.consentRequired === true,
    },
  };
}

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  if (!organizationId) return NextResponse.json({ error: "Не указано рабочее пространство." }, { status: 400 });
  const ctx = await context(organizationId);
  if ("response" in ctx) return ctx.response;
  const { data, error } = await ctx.supabase.from("funnels")
    .select("id,name,status,created_at,funnel_versions(version,definition,created_at)")
    .eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Не удалось загрузить воронки." }, { status: 500 });
  const funnels = (data || []).map((row: any) => {
    const versions = [...(row.funnel_versions || [])].sort((a: any, b: any) => b.version - a.version);
    return { id: row.id, name: row.name, status: row.status, created_at: row.created_at,
      version: versions[0]?.version || 0, definition: versions[0]?.definition || { steps: [], settings: {} },
      versions: versions.map((v: any) => ({ version: v.version, created_at: v.created_at })) };
  });
  return NextResponse.json({ funnels });
}

export async function POST(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const definition = normalizeDefinition(body.definition);
  if (!organizationId || !name || !definition) return NextResponse.json({ error: "Укажите название и корректную схему воронки (до 40 шагов)." }, { status: 422 });
  const ctx = await context(organizationId, true);
  if ("response" in ctx) return ctx.response;
  const { data: funnel, error } = await ctx.supabase.from("funnels")
    .insert({ organization_id: organizationId, name, status: "draft" }).select("id,name,status,created_at").single();
  if (error || !funnel) return NextResponse.json({ error: "Не удалось создать воронку." }, { status: 500 });
  const { error: versionError } = await ctx.supabase.from("funnel_versions")
    .insert({ organization_id: organizationId, funnel_id: funnel.id, version: 1, definition });
  if (versionError) {
    await ctx.supabase.from("funnels").delete().eq("id", funnel.id).eq("organization_id", organizationId);
    return NextResponse.json({ error: "Не удалось сохранить первую версию схемы." }, { status: 500 });
  }
  return NextResponse.json({ funnel: { ...funnel, version: 1, definition }, message: "Воронка сохранена как черновик. Запуск сценария пока не включён." }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const id = typeof body.id === "string" ? body.id : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const definition = normalizeDefinition(body.definition);
  if (!organizationId || !id || !name || !definition) return NextResponse.json({ error: "Проверьте название и схему воронки." }, { status: 422 });
  const ctx = await context(organizationId, true);
  if ("response" in ctx) return ctx.response;
  const { data: funnel, error: funnelError } = await ctx.supabase.from("funnels").update({ name })
    .eq("id", id).eq("organization_id", organizationId).select("id,name,status").maybeSingle();
  if (funnelError || !funnel) return NextResponse.json({ error: "Воронка не найдена или недоступна." }, { status: 404 });
  const { data: latest } = await ctx.supabase.from("funnel_versions").select("version")
    .eq("funnel_id", id).eq("organization_id", organizationId).order("version", { ascending: false }).limit(1).maybeSingle();
  const nextVersion = (latest?.version || 0) + 1;
  const { error: versionError } = await ctx.supabase.from("funnel_versions")
    .insert({ organization_id: organizationId, funnel_id: id, version: nextVersion, definition });
  if (versionError) return NextResponse.json({ error: "Название обновлено, но новую версию схемы сохранить не удалось. Повторите сохранение." }, { status: 500 });
  return NextResponse.json({ funnel: { ...funnel, version: nextVersion, definition }, message: `Сохранена версия v${nextVersion}. Воронка остаётся черновиком.` });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") || "";
  const id = url.searchParams.get("id") || "";
  if (!organizationId || !id) return NextResponse.json({ error: "Не указаны параметры удаления." }, { status: 400 });
  const ctx = await context(organizationId, true);
  if ("response" in ctx) return ctx.response;
  const { error: versionsError } = await ctx.supabase.from("funnel_versions").delete().eq("funnel_id", id).eq("organization_id", organizationId);
  if (versionsError) return NextResponse.json({ error: "Не удалось удалить версии воронки." }, { status: 500 });
  const { error } = await ctx.supabase.from("funnels").delete().eq("id", id).eq("organization_id", organizationId);
  if (error) return NextResponse.json({ error: "Не удалось удалить воронку." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
