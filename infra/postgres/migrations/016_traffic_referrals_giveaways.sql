-- 016_traffic_referrals_giveaways.sql
-- Additive: zero-budget traffic tools for auto-reply bots (referrals, giveaways, source tracking).
-- No secrets. Everything defaults to off / draft.

ALTER TABLE public.bot_autoreplies
  ADD COLUMN IF NOT EXISTS traffic_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS traffic_channel text,
  ADD COLUMN IF NOT EXISTS traffic_welcome text NOT NULL DEFAULT '';

ALTER TABLE public.bot_autoreplies
  DROP CONSTRAINT IF EXISTS bot_autoreplies_traffic_welcome_len;
ALTER TABLE public.bot_autoreplies
  ADD CONSTRAINT bot_autoreplies_traffic_welcome_len CHECK (char_length(traffic_welcome) <= 4096);

CREATE TABLE IF NOT EXISTS public.traffic_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES public.bot_autoreplies(id) ON DELETE CASCADE,
  tag text NOT NULL,
  name text NOT NULL,
  invite_link text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT traffic_sources_tag_format CHECK (tag ~ '^[a-z0-9_]{1,32}$'),
  CONSTRAINT traffic_sources_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  UNIQUE (bot_id, tag)
);

ALTER TABLE public.bot_autoreply_users
  ADD COLUMN IF NOT EXISTS ref_code text,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.bot_autoreply_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.traffic_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subscribed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscribed_checked_at timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS bot_autoreply_users_ref_code_uidx
  ON public.bot_autoreply_users (bot_id, ref_code) WHERE ref_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS bot_autoreply_users_referred_by_idx
  ON public.bot_autoreply_users (referred_by) WHERE referred_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS bot_autoreply_users_source_idx
  ON public.bot_autoreply_users (source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.traffic_giveaways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES public.bot_autoreplies(id) ON DELETE CASCADE,
  title text NOT NULL,
  prize text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  ends_at timestamp with time zone,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT traffic_giveaways_status_check CHECK (status = ANY (ARRAY['draft'::text, 'active'::text, 'finished'::text])),
  CONSTRAINT traffic_giveaways_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT traffic_giveaways_prize_len CHECK (char_length(prize) <= 1000),
  CONSTRAINT traffic_giveaways_desc_len CHECK (char_length(description) <= 4000)
);

CREATE INDEX IF NOT EXISTS traffic_giveaways_bot_status_idx
  ON public.traffic_giveaways (bot_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.traffic_giveaway_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  giveaway_id uuid NOT NULL REFERENCES public.traffic_giveaways(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.bot_autoreply_users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (giveaway_id, user_id)
);

ALTER TABLE public.bot_autoreply_messages DROP CONSTRAINT IF EXISTS bot_autoreply_messages_source_check;
ALTER TABLE public.bot_autoreply_messages ADD CONSTRAINT bot_autoreply_messages_source_check CHECK (
  source = ANY (ARRAY['user'::text, 'start'::text, 'main'::text, 'ai'::text, 'operator'::text, 'system'::text, 'traffic'::text])
);

ALTER TABLE public.traffic_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_giveaways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_giveaway_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS traffic_sources_tenant_isolation ON public.traffic_sources;
CREATE POLICY traffic_sources_tenant_isolation ON public.traffic_sources FOR ALL TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()));

DROP POLICY IF EXISTS traffic_giveaways_tenant_isolation ON public.traffic_giveaways;
CREATE POLICY traffic_giveaways_tenant_isolation ON public.traffic_giveaways FOR ALL TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()));

DROP POLICY IF EXISTS traffic_giveaway_entries_tenant_isolation ON public.traffic_giveaway_entries;
CREATE POLICY traffic_giveaway_entries_tenant_isolation ON public.traffic_giveaway_entries FOR ALL TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()));

REVOKE ALL ON TABLE public.traffic_sources FROM PUBLIC;
REVOKE ALL ON TABLE public.traffic_giveaways FROM PUBLIC;
REVOKE ALL ON TABLE public.traffic_giveaway_entries FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.traffic_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.traffic_giveaways TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.traffic_giveaway_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.traffic_sources TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.traffic_giveaways TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.traffic_giveaway_entries TO service_role;

COMMENT ON TABLE public.traffic_giveaways IS
  'Bot giveaways. Created as draft; the bot accepts entries only while status = active. Nothing is posted to channels automatically.';
