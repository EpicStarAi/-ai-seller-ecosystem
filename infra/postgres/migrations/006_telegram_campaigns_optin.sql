CREATE TABLE IF NOT EXISTS public.telegram_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  chat_id bigint NOT NULL,
  username text,
  first_name text,
  consent_at timestamptz NOT NULL,
  consent_source text NOT NULL DEFAULT 'telegram_bot_start',
  status text NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed','unsubscribed','blocked')),
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_telegram_subscribers_org_status ON public.telegram_subscribers(organization_id, status);
CREATE TABLE IF NOT EXISTS public.telegram_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.telegram_channels(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  message_text text NOT NULL CHECK (char_length(message_text) BETWEEN 1 AND 4096),
  audience_type text NOT NULL DEFAULT 'bot_subscribers' CHECK (audience_type = 'bot_subscribers'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sending','paused','completed','cancelled','failed')),
  scheduled_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telegram_campaigns_org_created ON public.telegram_campaigns(organization_id, created_at DESC);
ALTER TABLE public.telegram_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_subscribers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.telegram_subscribers;
CREATE POLICY tenant_isolation ON public.telegram_subscribers USING (organization_id::text = NULLIF(current_setting('app.current_org_id', true), '')) WITH CHECK (organization_id::text = NULLIF(current_setting('app.current_org_id', true), ''));
ALTER TABLE public.telegram_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_campaigns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.telegram_campaigns;
CREATE POLICY tenant_isolation ON public.telegram_campaigns USING (organization_id::text = NULLIF(current_setting('app.current_org_id', true), '')) WITH CHECK (organization_id::text = NULLIF(current_setting('app.current_org_id', true), ''));
