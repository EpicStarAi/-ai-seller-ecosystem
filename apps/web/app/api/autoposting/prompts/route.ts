import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 13000;

async function access(request: Request, write = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const organizationId = (request.method === "GET"
    ? new URL(request.url).searchParams.get("organizationId")
    : "") || "";
  return { supabase, user, organizationId };
}

async function member(supabase: Awaited<ReturnType<typeof createClient>>, organizationId: string, userId: string, write = false) {
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
  if (error || !membership || (write && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав для управления промптами." }, { status: 403 }) };
  }
  return { role: membership.role };
}

function parsePrompt(body: unknown) {
  const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const organizationId = typeof row.organizationId === "string" ? row.organizationId : "";
  const name = typeof row.name === "string" ? row.name.trim().slice(0, 120) : "";
  const text = typeof row.text === "string" ? row.text.trim().slice(0, MAX_TEXT) : "";
  if (!name || !text) return { error: "Укажите название и текст промпта (до 13 000 символов)." };
  return { organizationId, name, prompt_text: text };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  const gate = await member(supabase, organizationId, user.id);
  if ("response" in gate) return gate.response;
  const { data, error } = await supabase.from("user_prompts")
    .select("id,name,prompt_text,created_at,updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "Не удалось загрузить промпты." }, { status: 500 });
  const prompts = (data || []).map((row) => ({ id: row.id, name: row.name, text: row.prompt_text, created_at: row.created_at, updated_at: row.updated_at }));
  return NextResponse.json({ prompts });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
  let body: unknown = {};
  try { body = await request.json(); } catch { body = {}; }
  const parsed = parsePrompt(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const gate = await member(supabase, parsed.organizationId, user.id, true);
  if ("response" in gate) return gate.response;
  const { data, error } = await supabase.from("user_prompts").insert({
    organization_id: parsed.organizationId,
    name: parsed.name,
    prompt_text: parsed.prompt_text,
    created_by: user.id,
  }).select("id,name,prompt_text,created_at,updated_at").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Не удалось сохранить промпт." }, { status: 500 });
  return NextResponse.json({ prompt: { id: data.id, name: data.name, text: data.prompt_text, created_at: data.created_at, updated_at: data.updated_at } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { body = {}; }
  const id = typeof body.id === "string" ? body.id : "";
  const parsed = parsePrompt(body);
  if (!id) return NextResponse.json({ error: "Не указан промпт." }, { status: 400 });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const gate = await member(supabase, parsed.organizationId, user.id, true);
  if ("response" in gate) return gate.response;
  const { data, error } = await supabase.from("user_prompts").update({
    name: parsed.name,
    prompt_text: parsed.prompt_text,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("organization_id", parsed.organizationId)
    .select("id,name,prompt_text,created_at,updated_at").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Не удалось обновить промпт." }, { status: 500 });
  return NextResponse.json({ prompt: { id: data.id, name: data.name, text: data.prompt_text, created_at: data.created_at, updated_at: data.updated_at } });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") || "";
  const id = url.searchParams.get("id") || "";
  const gate = await member(supabase, organizationId, user.id, true);
  if ("response" in gate) return gate.response;
  if (!id) return NextResponse.json({ error: "Не указан промпт." }, { status: 400 });
  const { error } = await supabase.from("user_prompts").delete().eq("id", id).eq("organization_id", organizationId);
  if (error) return NextResponse.json({ error: "Не удалось удалить промпт." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
