import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function requireMember(organizationId: string, write = false) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  if (!organizationId) return { response: NextResponse.json({ error: "Не указан organizationId." }, { status: 400 }) };
  const { data: membership, error } = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (error || !membership || (write && !["owner", "admin"].includes(membership.role))) {
    return { response: NextResponse.json({ error: "Недостаточно прав." }, { status: 403 }) };
  }
  return { supabase, user, organizationId, role: membership.role };
}

export type PublicBot = {
  id: string;
  organization_id: string;
  name: string;
  telegram_bot_id: number | null;
  telegram_username: string | null;
  enabled: boolean;
  main_message: string;
  ai_enabled: boolean;
  prompt_id: string | null;
  knowledge_base: string;
  reply_limit_per_user: number | null;
  operator_mode_enabled: boolean;
  operator_chat_id: string | null;
  created_at: string;
  updated_at: string;
  has_token: boolean;
};

export function toPublicBot(row: Record<string, unknown>, hasToken = true): PublicBot {
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    name: String(row.name || ""),
    telegram_bot_id: row.telegram_bot_id == null ? null : Number(row.telegram_bot_id),
    telegram_username: row.telegram_username ? String(row.telegram_username) : null,
    enabled: row.enabled === true,
    main_message: String(row.main_message || ""),
    ai_enabled: row.ai_enabled === true,
    prompt_id: row.prompt_id ? String(row.prompt_id) : null,
    knowledge_base: String(row.knowledge_base || ""),
    reply_limit_per_user: row.reply_limit_per_user == null ? null : Number(row.reply_limit_per_user),
    operator_mode_enabled: row.operator_mode_enabled === true,
    operator_chat_id: row.operator_chat_id ? String(row.operator_chat_id) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    has_token: hasToken,
  };
}
