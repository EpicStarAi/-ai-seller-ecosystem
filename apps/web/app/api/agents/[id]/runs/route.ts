import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return { db, user: null, org: "" };
  const { data: membership } = await db.from("memberships").select("organization_id")
    .eq("user_id", user.id).limit(1).maybeSingle();
  return { db, user, org: membership?.organization_id || "" };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { db, user, org } = await context();
  if (!user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
  if (!org) return NextResponse.json({ error: "Рабочее пространство не найдено." }, { status: 409 });
  const { id } = await params;
  const { data: versions, error: versionsError } = await db.from("agent_versions")
    .select("id,version").eq("agent_id", id).eq("organization_id", org);
  if (versionsError) return NextResponse.json({ error: "Не удалось загрузить версии агента." }, { status: 500 });
  const ids = (versions || []).map((v: { id: string }) => v.id);
  if (!ids.length) return NextResponse.json({ runs: [] });
  const versionById = new Map((versions || []).map((v: { id: string; version: number }) => [v.id, v.version]));
  const { data: runs, error } = await db.from("agent_runs")
    .select("id,agent_version_id,status,usage,result,created_at")
    .eq("organization_id", org).in("agent_version_id", ids)
    .order("created_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: "Не удалось загрузить историю запусков." }, { status: 500 });
  return NextResponse.json({ runs: (runs || []).map((run: any) => ({
    id: run.id, status: run.status, usage: run.usage, result: run.result,
    created_at: run.created_at, version: versionById.get(run.agent_version_id) || 0
  })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { db, user, org } = await context();
  if (!user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
  if (!org) return NextResponse.json({ error: "Рабочее пространство не найдено." }, { status: 409 });
  const { id } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const { data: version, error: versionError } = await db.from("agent_versions").select("id")
    .eq("agent_id", id).eq("organization_id", org).order("version", { ascending: false }).limit(1).maybeSingle();
  if (versionError || !version) return NextResponse.json({ error: "Версия агента не найдена." }, { status: 404 });
  const status = body.status === "failed" ? "failed" : "succeeded";
  const provider = typeof body.provider === "string" ? body.provider.slice(0, 30) : "";
  const result = body.result && typeof body.result === "object" ? body.result : {};
  const { data: run, error } = await db.from("agent_runs").insert({
    organization_id: org, agent_version_id: version.id, status, request_id: crypto.randomUUID(),
    usage: provider ? { provider } : {}, result
  }).select("id,status,created_at").single();
  if (error || !run) return NextResponse.json({ error: "Не удалось записать запуск агента." }, { status: 500 });
  return NextResponse.json({ run });
}
