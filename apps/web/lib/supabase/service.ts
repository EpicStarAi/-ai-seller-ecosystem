import "server-only";

import { createClient } from "@supabase/supabase-js";

export function createServiceClient() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("Service role is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
