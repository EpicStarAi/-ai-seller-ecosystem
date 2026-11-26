import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request: Request, adminOnly = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (adminOnly && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав для управления веб-источниками." }, { status: 403 }) };
  }
  return { supabase, user, organizationId };
}

function publicIPv4(address: string) {
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b] = p;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}

function publicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return publicIPv4(address);
  if (version === 6) {
    const first = Number.parseInt(address.split(":")[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff && !address.toLowerCase().startsWith("2001:db8:");
  }
  return false;
}

async function validatePublicHttpsUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Укажите корректный URL сайта."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    throw new Error("Разрешены только публичные HTTPS-сайты на стандартном порту 443.");
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") ||
      isIP(host)) {
    throw new Error("Локальные адреса, IP-адреса и внутренние домены запрещены.");
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) {
    throw new Error("Домен должен разрешаться только в публичные IP-адреса.");
  }
  parsed.hash = "";
  return { url: parsed.toString(), domain: host };
}

export async function GET(request: Request) {
  const ctx = await context(request);
  if ("response" in ctx) return ctx.response;
  const flowId = new URL(request.url).searchParams.get("flowId") || "";
  if (!flowId) return NextResponse.json({ error: "Не указан веб-поток." }, { status: 400 });
  const { data: flow } = await ctx.supabase.from("autoposting_flows").select("id,source_type")
    .eq("id", flowId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (!flow || flow.source_type !== "web_search") return NextResponse.json({ error: "Веб-поток не найден." }, { status: 404 });
  const { data: sources, error } = await ctx.supabase.from("content_sources")
    .select("id,flow_id,source_kind,url,domain,title,permission_status,rights_note,ingest_enabled,last_scraped_at,last_error,created_at")
    .eq("organization_id", ctx.organizationId).eq("flow_id", flowId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Не удалось загрузить веб-источники." }, { status: 500 });
  const ids = (sources ?? []).map(source => source.id);
  let items: any[] = [];
  if (ids.length) {
    const result = await ctx.supabase.from("content_source_items")
      .select("id,source_id,source_url,canonical_url,title,review_status,fetched_at")
      .eq("organization_id", ctx.organizationId).in("source_id", ids)
      .order("fetched_at", { ascending: false }).limit(50);
    if (result.error) return NextResponse.json({ error: "Не удалось загрузить результаты извлечения." }, { status: 500 });
    items = result.data ?? [];
  }
  return NextResponse.json({ sources: (sources ?? []).map(source => ({
    ...source, items: items.filter(item => item.source_id === source.id),
  })) });
}

export async function POST(request: Request) {
  const ctx = await context(request, true);
  if ("response" in ctx) return ctx.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const flowId = typeof body.flowId === "string" ? body.flowId : "";
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  const titleInput = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
  const rightsConfirmed = body.rightsConfirmed === true;
  const rightsBasis = body.rightsBasis === "licensed" ? "licensed" : "owner_authorized";
  const rightsNote = typeof body.rightsNote === "string" ? body.rightsNote.trim().slice(0, 1000) : "";
  if (!flowId || !rawUrl || rawUrl.length > 2048) return NextResponse.json({ error: "Укажите веб-поток и URL сайта." }, { status: 422 });
  if (rightsConfirmed && rightsNote.length < 8) return NextResponse.json({ error: "Опишите основание прав: владение сайтом, договор или разрешение." }, { status: 422 });
  const { data: flow } = await ctx.supabase.from("autoposting_flows").select("id,source_type")
    .eq("id", flowId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (!flow || flow.source_type !== "web_search") return NextResponse.json({ error: "Выберите поток с типом источника «Поиск по интернету»." }, { status: 409 });
  try {
    const safe = await validatePublicHttpsUrl(rawUrl);
    const now = new Date().toISOString();
    const row = {
      organization_id: ctx.organizationId, flow_id: flowId, source_kind: "website",
      url: safe.url, domain: safe.domain, title: titleInput || safe.domain,
      permission_status: rightsConfirmed ? rightsBasis : "pending_review",
      rights_note: rightsNote || null, ingest_enabled: rightsConfirmed,
      created_by: ctx.user.id, updated_at: now,
    };
    const { data, error } = await ctx.supabase.from("content_sources").insert(row)
      .select("id,flow_id,url,domain,title,permission_status,rights_note,ingest_enabled,last_scraped_at,last_error,created_at").single();
    if (error?.code === "23505") return NextResponse.json({ error: "Этот сайт уже добавлен в выбранный поток." }, { status: 409 });
    if (error || !data) return NextResponse.json({ error: "Не удалось сохранить веб-источник." }, { status: 500 });
    return NextResponse.json({
      source: data,
      message: rightsConfirmed
        ? "Сайт добавлен и разрешён для ручного извлечения. Автоматический сбор пока не запускается."
        : "Сайт добавлен в карантин. Подтвердите права и основание использования, прежде чем извлекать контент.",
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось проверить адрес сайта." }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const ctx = await context(request, true);
  if ("response" in ctx) return ctx.response;
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const flowId = url.searchParams.get("flowId") || "";
  if (!id || !flowId) return NextResponse.json({ error: "Не указаны параметры удаления." }, { status: 400 });
  const { error } = await ctx.supabase.from("content_sources").delete()
    .eq("id", id).eq("flow_id", flowId).eq("organization_id", ctx.organizationId);
  if (error) return NextResponse.json({ error: "Не удалось удалить веб-источник." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
