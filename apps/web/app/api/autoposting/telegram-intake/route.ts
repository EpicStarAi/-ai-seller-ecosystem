import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request: Request, adminOnly = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") || "";
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (adminOnly && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав." }, { status: 403 }) };
  }
  return { supabase, user, organizationId };
}

export async function GET(request: Request) {
  const ctx = await context(request);
  if ("response" in ctx) return ctx.response;
  const flowId = new URL(request.url).searchParams.get("flowId") || "";
  if (!flowId) return NextResponse.json({ error: "Не указан поток." }, { status: 400 });
  const { data, error } = await ctx.supabase.from("telegram_content_items")
    .select("id,flow_id,donor_id,source_url,source_message_id,title,body,rights_basis,rights_note,review_status,created_at")
    .eq("organization_id", ctx.organizationId).eq("flow_id", flowId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Не удалось загрузить входящие материалы." }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await context(request, true);
  if ("response" in ctx) return ctx.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }

  const flowId = typeof body.flowId === "string" ? body.flowId : "";
  const donorId = typeof body.donorId === "string" ? body.donorId : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 240) : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const rightsBasis = ["owner_authorized", "licensed", "explicit_permission"].includes(body.rightsBasis) ? body.rightsBasis : "";
  const rightsNote = typeof body.rightsNote === "string" ? body.rightsNote.trim().slice(0, 1000) : "";
  if (!flowId || !donorId || !sourceUrl || !content || content.length > 50000) {
    return NextResponse.json({ error: "Укажите поток, донор, ссылку на публикацию и текст (до 50 000 символов)." }, { status: 422 });
  }
  if (!rightsBasis || rightsNote.length < 8) {
    return NextResponse.json({ error: "Укажите основание использования и пояснение (не менее 8 символов)." }, { status: 422 });
  }

  let parsed: URL;
  try { parsed = new URL(sourceUrl); } catch { return NextResponse.json({ error: "Некорректная ссылка на публикацию." }, { status: 422 }); }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "t.me" || parsed.username || parsed.password) {
    return NextResponse.json({ error: "Для Telegram-материала нужна публичная ссылка https://t.me/..." }, { status: 422 });
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0].startsWith("+") || parts[0] === "c") {
    return NextResponse.json({ error: "Укажите ссылку непосредственно на сообщение публичного канала." }, { status: 422 });
  }
  const messageId = parts[1];
  if (!/^\d+$/.test(messageId)) return NextResponse.json({ error: "Ссылка должна содержать числовой ID сообщения." }, { status: 422 });
  parsed.search = "";
  parsed.hash = "";

  const { data: donor, error: donorError } = await ctx.supabase.from("autoposting_donors")
    .select("id,flow_id,organization_id,username,title")
    .eq("id", donorId).eq("flow_id", flowId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (donorError || !donor) return NextResponse.json({ error: "Донор не найден в выбранном потоке." }, { status: 404 });
  if (donor.username && donor.username.toLowerCase() !== parts[0].toLowerCase()) {
    return NextResponse.json({ error: "Ссылка на сообщение не соответствует выбранному донорскому каналу." }, { status: 422 });
  }

  const hash = createHash("sha256").update(content).digest("hex");
  const { data, error } = await ctx.supabase.from("telegram_content_items").insert({
    organization_id: ctx.organizationId, flow_id: flowId, donor_id: donorId,
    source_url: parsed.toString(), source_message_id: messageId,
    title: title || donor.title, body: content, content_hash: hash,
    rights_basis: rightsBasis, rights_note: rightsNote,
    review_status: "pending_review",
    metadata: { intake_method: "user_submitted", source_type: "telegram_public_post" },
    submitted_by: ctx.user.id,
  }).select("id,flow_id,donor_id,source_url,source_message_id,title,review_status,created_at").single();

  if (error?.code === "23505") return NextResponse.json({ error: "Эта публикация уже добавлена (дубликат)." }, { status: 409 });
  if (error || !data) return NextResponse.json({ error: "Не удалось сохранить материал." }, { status: 500 });
  return NextResponse.json({ item: data, message: "Материал сохранён во входящей очереди. Он не отправлен AI-агентам и не опубликован; требуется проверка." }, { status: 201 });
}
