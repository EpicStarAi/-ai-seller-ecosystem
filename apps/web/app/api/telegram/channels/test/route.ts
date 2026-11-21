import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });

  let body: { organizationId?: string; channelId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 }); }
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  if (!organizationId || !channelId) return NextResponse.json({ error: "Не указано рабочее пространство или канал." }, { status: 400 });

  const { data: membership } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Только владелец или администратор может запускать тестовую публикацию." }, { status: 403 });
  }

  const { data: channel, error: channelError } = await supabase.from("telegram_channels")
    .select("id,chat_id,title,can_post_messages,integration_id")
    .eq("id", channelId).eq("organization_id", organizationId).maybeSingle();
  if (channelError || !channel) return NextResponse.json({ error: "Канал не найден в этом рабочем пространстве." }, { status: 404 });
  if (!channel.can_post_messages) return NextResponse.json({ error: "В реестре не подтверждено право публикации." }, { status: 409 });

  const { data: stored, error: secretError } = await supabase.from("integration_secrets")
    .select("nonce,ciphertext").eq("integration_id", channel.integration_id).maybeSingle();
  if (secretError || !stored) return NextResponse.json({ error: "Credential Telegram не найден." }, { status: 409 });

  let token: string;
  try { token = decryptIntegrationSecret(stored.nonce, stored.ciphertext, organizationId, "telegram"); }
  catch { return NextResponse.json({ error: "Не удалось расшифровать Telegram credential." }, { status: 500 }); }

  const text = "🧪 Тестовая публикация AI Seller Ecosystem\nTelegram Bot API подключён. Проверка отправки сообщения выполнена.";
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: channel.chat_id, text, disable_web_page_preview: true }),
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return NextResponse.json({ error: typeof result.description === "string" ? result.description : "Telegram не принял публикацию." }, { status: 502 });
    }
    return NextResponse.json({
      ok: true, channel: channel.title, message_id: result.result?.message_id,
      date: result.result?.date, text: result.result?.text,
    });
  } catch {
    return NextResponse.json({ error: "Сетевая ошибка при отправке сообщения в Telegram." }, { status: 502 });
  }
}
