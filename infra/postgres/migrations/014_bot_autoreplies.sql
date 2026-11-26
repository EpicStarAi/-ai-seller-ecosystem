-- 014_bot_autoreplies.sql
-- Additive: Telegram bot auto-replies (Textback-style). All bots default to disabled.
-- Tokens are stored encrypted in bot_autoreply_secrets (service_role only).

CREATE TABLE IF NOT EXISTS public.bot_autoreplies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  telegram_bot_id bigint,
  telegram_username text,
  enabled boolean NOT NULL DEFAULT false,
  main_message text NOT NULL DEFAULT '',
  ai_enabled boolean NOT NULL DEFAULT false,
  prompt_id uuid REFERENCES public.user_prompts(id) ON DELETE SET NULL,
  knowledge_base text NOT NULL DEFAULT '',
  reply_limit_per_user integer,
  operator_mode_enabled boolean NOT NULL DEFAULT false,
  operator_chat_id text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bot_autoreplies_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT bot_autoreplies_main_message_len CHECK (char_length(main_message) BETWEEN 0 AND 4096),
  CONSTRAINT bot_autoreplies_kb_len CHECK (char_length(knowledge_base) BETWEEN 0 AND 200000),
  CONSTRAINT bot_autoreplies_reply_limit CHECK (
    reply_limit_per_user IS NULL OR (reply_limit_per_user >= 1 AND reply_limit_per_user <= 1000000)
  )
);

CREATE INDEX IF NOT EXISTS bot_autoreplies_org_updated_idx
  ON public.bot_autoreplies (organization_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS bot_autoreplies_telegram_bot_id_idx
  ON public.bot_autoreplies (telegram_bot_id)
  WHERE telegram_bot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.bot_autoreply_secrets (
  bot_id uuid PRIMARY KEY REFERENCES public.bot_autoreplies(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nonce bytea NOT NULL,
  ciphertext bytea NOT NULL,
  webhook_secret text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bot_autoreply_secrets_webhook_len CHECK (char_length(webhook_secret) BETWEEN 32 AND 128)
);

CREATE TABLE IF NOT EXISTS public.bot_autoreply_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES public.bot_autoreplies(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  telegram_chat_id text NOT NULL,
  username text,
  first_name text,
  last_name text,
  language_code text,
  reply_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (bot_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS bot_autoreply_users_bot_last_seen_idx
  ON public.bot_autoreply_users (bot_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS bot_autoreply_users_search_idx
  ON public.bot_autoreply_users (bot_id, username, first_name, last_name);

CREATE TABLE IF NOT EXISTS public.bot_autoreply_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES public.bot_autoreplies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.bot_autoreply_users(id) ON DELETE CASCADE,
  direction text NOT NULL,
  source text NOT NULL,
  telegram_message_id bigint,
  telegram_chat_id text,
  operator_forward_message_id bigint,
  body text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bot_autoreply_messages_direction_check CHECK (direction = ANY (ARRAY['in'::text, 'out'::text])),
  CONSTRAINT bot_autoreply_messages_source_check CHECK (
    source = ANY (ARRAY['user'::text, 'start'::text, 'main'::text, 'ai'::text, 'operator'::text, 'system'::text])
  ),
  CONSTRAINT bot_autoreply_messages_body_len CHECK (char_length(body) <= 8192)
);

CREATE INDEX IF NOT EXISTS bot_autoreply_messages_bot_created_idx
  ON public.bot_autoreply_messages (bot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bot_autoreply_messages_user_created_idx
  ON public.bot_autoreply_messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bot_autoreply_messages_operator_fwd_idx
  ON public.bot_autoreply_messages (bot_id, operator_forward_message_id)
  WHERE operator_forward_message_id IS NOT NULL;

ALTER TABLE public.bot_autoreplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_autoreply_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_autoreply_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_autoreply_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_autoreply_secrets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_autoreplies_tenant_isolation ON public.bot_autoreplies;
CREATE POLICY bot_autoreplies_tenant_isolation
  ON public.bot_autoreplies
  FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()));

DROP POLICY IF EXISTS bot_autoreply_users_tenant_isolation ON public.bot_autoreply_users;
CREATE POLICY bot_autoreply_users_tenant_isolation
  ON public.bot_autoreply_users
  FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()));

DROP POLICY IF EXISTS bot_autoreply_messages_tenant_isolation ON public.bot_autoreply_messages;
CREATE POLICY bot_autoreply_messages_tenant_isolation
  ON public.bot_autoreply_messages
  FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM public.memberships m WHERE m.user_id = auth.uid()));

-- Secrets: no authenticated access. service_role only (webhook and server routes after a membership check).
REVOKE ALL ON TABLE public.bot_autoreply_secrets FROM PUBLIC;
REVOKE ALL ON TABLE public.bot_autoreply_secrets FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bot_autoreply_secrets TO service_role;

REVOKE ALL ON TABLE public.bot_autoreplies FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bot_autoreplies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.bot_autoreplies TO service_role;

REVOKE ALL ON TABLE public.bot_autoreply_users FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bot_autoreply_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.bot_autoreply_users TO service_role;

REVOKE ALL ON TABLE public.bot_autoreply_messages FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bot_autoreply_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.bot_autoreply_messages TO service_role;

COMMENT ON TABLE public.bot_autoreplies IS
  'Textback-style Telegram auto-reply bots. enabled defaults to false; webhooks are set only when the owner turns a bot on.';
