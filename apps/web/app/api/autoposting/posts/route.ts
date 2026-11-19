import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(request: Request, write = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (write && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав для модерации публикаций." }, { status: 403 }) };
  }
  return { supabase, user, organizationId, role: membership.role };
}

export async function GET(request: Request) {
  const ctx = await access(request);
  if ("response" in ctx) return ctx.response;
  const status = new URL(request.url).searchParams.get("status") || "pending_review";
  const allowed = ["pending_review", "approved", "rejected", "rejected_auto", "published", "failed"];
  const statuses = status === "queue" ? ["pending_review", "failed"] : allowed.includes(status) ? [status] : ["pending_review"];
  const { data, error } = await ctx.supabase.from("autoposting_posts")
    .select("id,flow_id,content_item_id,status,original_text,draft_text,source_url,provider,model,rejection_reason,last_error,published_message_id,published_at,created_at,updated_at,autoposting_flows(name)")
    .eq("organization_id", ctx.organizationId)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "Не удалось загрузить очередь модерации." }, { status: 500 });
  const { count: pendingCount } = await ctx.supabase.from("autoposting_posts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId)
    .eq("status", "pending_review");
  return NextResponse.json({ posts: data ?? [], pendingCount: pendingCount ?? 0 });
}
