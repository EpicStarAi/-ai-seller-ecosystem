-- 007_baseline_autoposting.sql
--
-- Baseline captured from production Supabase project hmpaxuoemgiqejtmvocq
-- on 2026-11-19 (Europe/Kiev). Schema-only. Do not apply to production
-- automatically.
--
-- Intent: idempotent (CREATE IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS / guarded ADD CONSTRAINT). No data. No secrets.
--
-- Prerequisites (not created here; must already exist):
--   * public.organizations(id uuid) -- FK target for all three tables
--   * public.integrations(id uuid) -- FK target for telegram_channels.integration_id
--   * auth.users(id uuid) -- FK target for created_by on flows and donors
--   * public.memberships(organization_id, user_id) -- referenced by RLS policies
--   * auth.uid() -- referenced by RLS policies
--   * public.telegram_content_items -- written by ingest_telegram_listener_post
--     (unique (donor_id, content_hash); nullable submitted_by; rights_basis
--     allows 'pending_rights_review')
--   * extension pgcrypto in schema extensions (extensions.digest)
--   * roles: authenticated, anon, service_role
--
-- Notes matching production at capture time:
--   * RLS is enabled but NOT forced (relforcerowsecurity = false) on all three tables.
--   * telegram_channels policy also allows app.current_org_id; flows/donors do not.
--   * No triggers and no serial sequences (ids default to gen_random_uuid()).
--   * Listener RPCs are SECURITY DEFINER with SET search_path TO public, extensions.
--   * Production compares sha256(p_secret) to a hardcoded digest inside both
--     function bodies. That digest is intentionally omitted from this file
--     because the git repository is public. This migration uses
--     current_setting('app.ingest_secret_sha256', true) instead. Configure
--     that setting in any environment where the RPCs must authenticate.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.telegram_channels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  chat_id text NOT NULL,
  username text,
  title text NOT NULL,
  chat_type text NOT NULL,
  bot_status text NOT NULL DEFAULT 'unknown'::text,
  can_post_messages boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.autoposting_flows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}'::text[],
  ai_prompt text NOT NULL,
  use_ai_editor boolean NOT NULL DEFAULT false,
  generate_image boolean NOT NULL DEFAULT false,
  moderation_enabled boolean NOT NULL DEFAULT false,
  max_forwarding_enabled boolean NOT NULL DEFAULT false,
  schedule_mode text NOT NULL DEFAULT 'interval'::text,
  interval_minutes integer NOT NULL DEFAULT 60,
  cron_expression text,
  status text NOT NULL DEFAULT 'draft'::text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.autoposting_donors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  source_type text NOT NULL DEFAULT 'telegram_channel'::text,
  chat_id text NOT NULL,
  username text,
  title text NOT NULL,
  access_status text NOT NULL DEFAULT 'not_checked'::text,
  bot_can_receive_posts boolean NOT NULL DEFAULT false,
  last_checked_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Constraints (idempotent)
-- ---------------------------------------------------------------------------

DO $guard$
BEGIN
  -- telegram_channels
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'telegram_channels'
      AND c.conname = 'telegram_channels_pkey'
  ) THEN
    ALTER TABLE public.telegram_channels
      ADD CONSTRAINT telegram_channels_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'telegram_channels'
      AND c.conname = 'telegram_channels_organization_id_chat_id_key'
  ) THEN
    ALTER TABLE public.telegram_channels
      ADD CONSTRAINT telegram_channels_organization_id_chat_id_key
      UNIQUE (organization_id, chat_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'telegram_channels'
      AND c.conname = 'telegram_channels_organization_id_fkey'
  ) THEN
    ALTER TABLE public.telegram_channels
      ADD CONSTRAINT telegram_channels_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'telegram_channels'
      AND c.conname = 'telegram_channels_integration_id_fkey'
  ) THEN
    ALTER TABLE public.telegram_channels
      ADD CONSTRAINT telegram_channels_integration_id_fkey
      FOREIGN KEY (integration_id) REFERENCES public.integrations(id) ON DELETE CASCADE;
  END IF;

  -- autoposting_flows
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_pkey'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_id_org_unique'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_id_org_unique UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_source_type_check'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_source_type_check
      CHECK (source_type = ANY (ARRAY['web_search'::text, 'telegram_channels'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_schedule_mode_check'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_schedule_mode_check
      CHECK (schedule_mode = ANY (ARRAY['interval'::text, 'cron'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_cron_required'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_cron_required
      CHECK (schedule_mode <> 'cron'::text OR cron_expression IS NOT NULL AND length(TRIM(BOTH FROM cron_expression)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_interval_minutes_check'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_interval_minutes_check
      CHECK (interval_minutes >= 30);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_status_check'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_status_check
      CHECK (status = ANY (ARRAY['draft'::text, 'paused'::text, 'active'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_organization_id_fkey'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_channel_id_fkey'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_channel_id_fkey
      FOREIGN KEY (channel_id) REFERENCES public.telegram_channels(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_flows'
      AND c.conname = 'autoposting_flows_created_by_fkey'
  ) THEN
    ALTER TABLE public.autoposting_flows
      ADD CONSTRAINT autoposting_flows_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id);
  END IF;

  -- autoposting_donors
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_donors'
      AND c.conname = 'autoposting_donors_pkey'
  ) THEN
    ALTER TABLE public.autoposting_donors
      ADD CONSTRAINT autoposting_donors_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_donors'
      AND c.conname = 'autoposting_donors_organization_id_flow_id_chat_id_key'
  ) THEN
    ALTER TABLE public.autoposting_donors
      ADD CONSTRAINT autoposting_donors_organization_id_flow_id_chat_id_key
      UNIQUE (organization_id, flow_id, chat_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_donors'
      AND c.conname = 'autoposting_donors_source_type_check'
  ) THEN
    ALTER TABLE public.autoposting_donors
      ADD CONSTRAINT autoposting_donors_source_type_check
      CHECK (source_type = 'telegram_channel'::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_donors'
      AND c.conname = 'autoposting_donors_access_status_check'
  ) THEN
    ALTER TABLE public.autoposting_donors
      ADD CONSTRAINT autoposting_donors_access_status_check
      CHECK (access_status = ANY (ARRAY['not_checked'::text, 'bot_member'::text, 'bot_not_member'::text, 'inaccessible'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_donors'
      AND c.conname = 'autoposting_donors_organization_id_fkey'
  ) THEN
    ALTER TABLE public.autoposting_donors
      ADD CONSTRAINT autoposting_donors_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_donors'
      AND c.conname = 'autoposting_donors_flow_id_fkey'
  ) THEN
    ALTER TABLE public.autoposting_donors
      ADD CONSTRAINT autoposting_donors_flow_id_fkey
      FOREIGN KEY (flow_id) REFERENCES public.autoposting_flows(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'autoposting_donors'
      AND c.conname = 'autoposting_donors_created_by_fkey'
  ) THEN
    ALTER TABLE public.autoposting_donors
      ADD CONSTRAINT autoposting_donors_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id);
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- Extra indexes (unique/PK indexes are created with their constraints)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS autoposting_flows_org_created_idx
  ON public.autoposting_flows USING btree (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS autoposting_flows_status_idx
  ON public.autoposting_flows USING btree (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS autoposting_donors_flow_idx
  ON public.autoposting_donors USING btree (organization_id, flow_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS autoposting_donors_id_org_flow_unique
  ON public.autoposting_donors USING btree (id, organization_id, flow_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.telegram_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autoposting_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autoposting_donors ENABLE ROW LEVEL SECURITY;
-- Production does not FORCE RLS on these three tables.

DROP POLICY IF EXISTS telegram_channels_tenant_isolation ON public.telegram_channels;
CREATE POLICY telegram_channels_tenant_isolation
  ON public.telegram_channels
  FOR ALL
  TO authenticated
  USING (
    (organization_id IN (SELECT m.organization_id FROM memberships m WHERE (m.user_id = auth.uid())))
    OR ((organization_id)::text = NULLIF(current_setting('app.current_org_id'::text, true), ''::text))
  )
  WITH CHECK (
    (organization_id IN (SELECT m.organization_id FROM memberships m WHERE (m.user_id = auth.uid())))
    OR ((organization_id)::text = NULLIF(current_setting('app.current_org_id'::text, true), ''::text))
  );

DROP POLICY IF EXISTS autoposting_flows_tenant_isolation ON public.autoposting_flows;
CREATE POLICY autoposting_flows_tenant_isolation
  ON public.autoposting_flows
  FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM memberships m WHERE (m.user_id = auth.uid())))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM memberships m WHERE (m.user_id = auth.uid())));

DROP POLICY IF EXISTS autoposting_donors_tenant_isolation ON public.autoposting_donors;
CREATE POLICY autoposting_donors_tenant_isolation
  ON public.autoposting_donors
  FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT m.organization_id FROM memberships m WHERE (m.user_id = auth.uid())))
  WITH CHECK (organization_id IN (SELECT m.organization_id FROM memberships m WHERE (m.user_id = auth.uid())));

-- ---------------------------------------------------------------------------
-- Grants (match production relacl / proacl; owner grants omitted)
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.telegram_channels FROM PUBLIC;
REVOKE ALL ON TABLE public.autoposting_flows FROM PUBLIC;
REVOKE ALL ON TABLE public.autoposting_donors FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telegram_channels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.autoposting_flows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.autoposting_donors TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.telegram_channels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.autoposting_flows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.autoposting_donors TO service_role;

-- ---------------------------------------------------------------------------
-- Listener RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_telegram_listener_donors(p_secret text)
 RETURNS TABLE(id uuid, organization_id uuid, flow_id uuid, chat_id text, username text, title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  -- Production uses a hardcoded sha256 hex digest here. That digest is not
  -- stored in this public repository. Set app.ingest_secret_sha256 instead.
  if p_secret is null or encode(extensions.digest(p_secret, 'sha256'), 'hex') <> current_setting('app.ingest_secret_sha256', true) then
    raise exception 'unauthorized';
  end if;
  return query
    select d.id, d.organization_id, d.flow_id, d.chat_id, d.username, d.title
    from public.autoposting_donors d
    join public.autoposting_flows f on f.id=d.flow_id and f.organization_id=d.organization_id
    where d.source_type='telegram_channel' and f.source_type='telegram_channels';
end;
$function$;

CREATE OR REPLACE FUNCTION public.ingest_telegram_listener_post(p_secret text, p_donor_id uuid, p_message_id text, p_message_text text, p_message_date timestamp with time zone, p_media jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  d public.autoposting_donors%rowtype;
  v_body text;
  v_hash text;
  v_url text;
  v_id uuid;
begin
  -- Production uses a hardcoded sha256 hex digest here. That digest is not
  -- stored in this public repository. Set app.ingest_secret_sha256 instead.
  if p_secret is null or encode(extensions.digest(p_secret, 'sha256'), 'hex') <> current_setting('app.ingest_secret_sha256', true) then
    raise exception 'unauthorized';
  end if;
  if p_donor_id is null or p_message_id is null or p_message_id !~ '^[0-9]{1,20}$' then
    raise exception 'invalid source message';
  end if;
  select * into d from public.autoposting_donors where id=p_donor_id;
  if not found then raise exception 'donor not found'; end if;
  v_body := left(coalesce(nullif(trim(p_message_text),''),'[Публикация содержит медиа без текстового описания]'),50000);
  v_hash := encode(extensions.digest(v_body, 'sha256'),'hex');
  if d.username is not null and length(trim(d.username)) > 0 then
    v_url := 'https://t.me/' || regexp_replace(d.username, '^@', '') || '/' || p_message_id;
  else
    v_url := 'https://t.me/c/' || regexp_replace(d.chat_id, '^-100', '') || '/' || p_message_id;
  end if;
  insert into public.telegram_content_items (
    organization_id, flow_id, donor_id, source_url, source_message_id, title, body,
    content_hash, rights_basis, rights_note, review_status, metadata, submitted_by
  ) values (
    d.organization_id, d.flow_id, d.id, v_url, p_message_id, d.title, v_body,
    v_hash, 'pending_rights_review',
    'Получено автоматическим мониторингом. Проверьте право на повторное использование до публикации.',
    'pending_review',
    jsonb_build_object('intake_method','mtproto_listener','message_date',p_message_date,'media',coalesce(p_media,'{}'::jsonb)),
    null
  )
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.telegram_content_items
    where donor_id=d.id and (source_message_id=p_message_id or content_hash=v_hash)
    order by created_at desc limit 1;
    return jsonb_build_object('id',v_id,'duplicate',true);
  end if;
  return jsonb_build_object('id',v_id,'duplicate',false);
end;
$function$;

REVOKE ALL ON FUNCTION public.list_telegram_listener_donors(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_telegram_listener_post(text, uuid, text, text, timestamp with time zone, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_telegram_listener_donors(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingest_telegram_listener_post(text, uuid, text, text, timestamp with time zone, jsonb) TO anon, authenticated, service_role;
