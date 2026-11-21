import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

async function context(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || !["owner", "admin"].includes(membership.role)) {
    return { response: NextResponse.json({ error: "Только владелец или администратор может запускать извлечение." }, { status: 403 }) };
  }
  return { supabase, organizationId };
}

function publicIPv4(address: string) {
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
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
async function assertPublicHttps(urlValue: string) {
  const url = new URL(urlValue);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || !host.includes(".") || isIP(host) ||
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test")) throw new Error("Недопустимый адрес источника.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error("Домен не разрешается только в публичные IP-адреса.");
}

export async function POST(request: Request) {
  const ctx = await context(request);
  if ("response" in ctx) return ctx.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  if (!sourceId) return NextResponse.json({ error: "Не указан веб-источник." }, { status: 400 });
  const { data: source, error: sourceError } = await ctx.supabase.from("content_sources")
    .select("id,flow_id,url,domain,title,permission_status,ingest_enabled")
    .eq("id", sourceId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (sourceError || !source) return NextResponse.json({ error: "Веб-источник не найден." }, { status: 404 });
  if (!source.ingest_enabled || !["owner_authorized", "licensed"].includes(source.permission_status)) {
    return NextResponse.json({ error: "Извлечение заблокировано: подтвердите права и основание использования источника." }, { status: 409 });
  }
  const base = (process.env.FIRECRAWL_API_URL || "http://127.0.0.1:3002").replace(/\/$/, "");
  if (!base.startsWith("http://127.0.0.1:") && !base.startsWith("http://localhost:")) {
    return NextResponse.json({ error: "Firecrawl должен быть настроен на локальный адрес VPS." }, { status: 503 });
  }
  try {
    await assertPublicHttps(source.url);
    const response = await fetch(base + "/v2/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: source.url, formats: ["markdown"], onlyMainContent: true, timeout: 45000 }),
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
    const payload = await response.json();
    if (!response.ok || payload.success !== true || !payload.data) {
      const message = typeof payload.error === "string" ? payload.error : "Firecrawl не смог извлечь страницу.";
      await ctx.supabase.from("content_sources").update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("id", sourceId).eq("organization_id", ctx.organizationId);
      return NextResponse.json({ error: message }, { status: response.status >= 400 && response.status < 500 ? response.status : 502 });
    }
    const data = payload.data;
    const markdown = typeof data.markdown === "string" ? data.markdown.slice(0, 250000) : "";
    if (!markdown.trim()) return NextResponse.json({ error: "Страница получена, но Firecrawl не вернул текстовый контент." }, { status: 422 });
    const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
    const canonicalUrl = typeof metadata.canonical === "string" ? metadata.canonical : typeof data.url === "string" ? data.url : source.url;
    const title = typeof metadata.title === "string" ? metadata.title.slice(0, 500) : source.title;
    const description = typeof metadata.description === "string" ? metadata.description.slice(0, 2000) : null;
    const contentHash = createHash("sha256").update(markdown).digest("hex");
    const { data: previousItem, error: previousItemError } = await ctx.supabase.from("content_source_items")
      .select("content_hash,review_status").eq("source_id", sourceId).eq("canonical_url", canonicalUrl).maybeSingle();
    if (previousItemError) return NextResponse.json({ error: "Не удалось проверить предыдущую версию материала." }, { status: 500 });
    const reviewStatus = previousItem?.content_hash === contentHash ? previousItem.review_status : "pending_review";
    const now = new Date().toISOString();
    const { data: item, error: itemError } = await ctx.supabase.from("content_source_items").upsert({
      organization_id: ctx.organizationId, source_id: sourceId, source_url: source.url,
      canonical_url: canonicalUrl, title, description, markdown, content_hash: contentHash,
      metadata: { title, description, sourceURL: data.url ?? source.url, statusCode: metadata.statusCode ?? null },
      review_status: reviewStatus, fetched_at: now,
    }, { onConflict: "source_id,canonical_url" })
      .select("id,title,canonical_url,review_status,fetched_at,content_hash").single();
    if (itemError || !item) return NextResponse.json({ error: "Текст извлечён, но не удалось сохранить материал." }, { status: 500 });
    await ctx.supabase.from("content_sources").update({ last_scraped_at: now, last_error: null, updated_at: now })
      .eq("id", sourceId).eq("organization_id", ctx.organizationId);
    return NextResponse.json({ item, message: "Страница извлечена и сохранена в очереди проверки. AI-обработка и публикация не запускались." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка Firecrawl.";
    await ctx.supabase.from("content_sources").update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", sourceId).eq("organization_id", ctx.organizationId);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
