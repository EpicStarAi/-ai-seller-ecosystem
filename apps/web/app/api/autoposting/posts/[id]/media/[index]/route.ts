import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePostMedia } from "@/lib/autoposting/media";
import { resolveMediaFile } from "@/lib/autoposting/media-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; index: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  if (!organizationId) return NextResponse.json({ error: "Не указан organizationId." }, { status: 400 });
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership) return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  const { id, index } = await context.params;
  const offset = Number(index);
  if (!Number.isInteger(offset) || offset < 0 || offset > 9) return NextResponse.json({ error: "Неверный индекс медиа." }, { status: 400 });
  const { data: post, error: postError } = await supabase.from("autoposting_posts")
    .select("id,media").eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (postError || !post) return NextResponse.json({ error: "Черновик не найден." }, { status: 404 });
  const item = parsePostMedia(post.media).items[offset];
  if (!item) return NextResponse.json({ error: "Медиафайл не найден." }, { status: 404 });
  const path = resolveMediaFile(item.relpath);
  if (!path) return NextResponse.json({ error: "Файл недоступен." }, { status: 404 });
  const bytes = await readFile(path);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": item.mime || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
