-- Add integration metadata and an encrypted credential store.
ALTER TABLE public.integrations
  ADD COLUMN label text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN last_tested_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE public.integration_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL UNIQUE REFERENCES public.integrations(id) ON DELETE CASCADE,
  nonce bytea NOT NULL,
  ciphertext bytea NOT NULL,
  key_version smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Supabase Auth JWTs are used by the web server routes. The custom GUC predicates
-- remain as a compatibility path for the future FastAPI runtime.
DROP POLICY users_select_self ON public.users;
DROP POLICY users_insert_self ON public.users;
DROP POLICY users_update_self ON public.users;
CREATE POLICY users_select_self ON public.users FOR SELECT USING (
  id = auth.uid()
  OR id::text = NULLIF(current_setting('app.current_user_id', true), '')
  OR auth_subject = NULLIF(current_setting('app.current_auth_subject', true), '')
);
CREATE POLICY users_insert_self ON public.users FOR INSERT WITH CHECK (
  id = auth.uid()
  OR auth_subject = NULLIF(current_setting('app.current_auth_subject', true), '')
);
CREATE POLICY users_update_self ON public.users FOR UPDATE USING (
  id = auth.uid()
  OR id::text = NULLIF(current_setting('app.current_user_id', true), '')
  OR auth_subject = NULLIF(current_setting('app.current_auth_subject', true), '')
) WITH CHECK (
  id = auth.uid()
  OR id::text = NULLIF(current_setting('app.current_user_id', true), '')
  OR auth_subject = NULLIF(current_setting('app.current_auth_subject', true), '')
);

DROP POLICY organizations_select_member_or_creator ON public.organizations;
DROP POLICY organizations_insert_creator ON public.organizations;
DROP POLICY organizations_update_admin ON public.organizations;
CREATE POLICY organizations_select_member_or_creator ON public.organizations FOR SELECT USING (
  created_by_user_id = auth.uid()
  OR created_by_user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
  OR EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.organization_id = organizations.id
      AND (m.user_id = auth.uid()
        OR m.user_id::text = NULLIF(current_setting('app.current_user_id', true), ''))
  )
);
CREATE POLICY organizations_insert_creator ON public.organizations FOR INSERT WITH CHECK (
  created_by_user_id = auth.uid()
  OR created_by_user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
);
CREATE POLICY organizations_update_admin ON public.organizations FOR UPDATE USING (
  created_by_user_id = auth.uid()
  OR created_by_user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
  OR EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.organization_id = organizations.id
      AND (m.user_id = auth.uid()
        OR m.user_id::text = NULLIF(current_setting('app.current_user_id', true), ''))
      AND m.role IN ('owner', 'admin')
  )
) WITH CHECK (
  created_by_user_id = auth.uid()
  OR created_by_user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
);

DROP POLICY memberships_select_self_or_tenant ON public.memberships;
DROP POLICY memberships_insert_owner_bootstrap_or_admin ON public.memberships;
DROP POLICY memberships_update_admin ON public.memberships;
CREATE POLICY memberships_select_self_or_tenant ON public.memberships FOR SELECT USING (
  user_id = auth.uid()
  OR user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
  OR organization_id::text = NULLIF(current_setting('app.current_org_id', true), '')
);
CREATE POLICY memberships_insert_owner_bootstrap_or_admin ON public.memberships FOR INSERT WITH CHECK (
  (
    (user_id = auth.uid()
      OR user_id::text = NULLIF(current_setting('app.current_user_id', true), ''))
    AND role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = memberships.organization_id
        AND (o.created_by_user_id = auth.uid()
          OR o.created_by_user_id::text = NULLIF(current_setting('app.current_user_id', true), ''))
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.memberships actor
    WHERE actor.organization_id = memberships.organization_id
      AND (actor.user_id = auth.uid()
        OR actor.user_id::text = NULLIF(current_setting('app.current_user_id', true), ''))
      AND actor.role IN ('owner', 'admin')
  )
);
CREATE POLICY memberships_update_admin ON public.memberships FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.memberships actor
    WHERE actor.organization_id = memberships.organization_id
      AND (actor.user_id = auth.uid()
        OR actor.user_id::text = NULLIF(current_setting('app.current_user_id', true), ''))
      AND actor.role IN ('owner', 'admin')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.memberships actor
    WHERE actor.organization_id = memberships.organization_id
      AND (actor.user_id = auth.uid()
        OR actor.user_id::text = NULLIF(current_setting('app.current_user_id', true), ''))
      AND actor.role IN ('owner', 'admin')
  )
);

-- Replace GUC-only tenant policies with policies that also support Supabase Auth JWTs.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workspaces', 'projects', 'integrations', 'contacts', 'conversations',
    'messages', 'agents', 'agent_versions', 'agent_runs', 'funnels',
    'funnel_versions', 'subscriptions', 'ledger_entries', 'audit_logs'
  ]
  LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (' ||
      'organization_id::text = NULLIF(current_setting(''app.current_org_id'', true), '''') ' ||
      'OR organization_id IN (SELECT m.organization_id FROM public.memberships m ' ||
      'WHERE m.user_id = auth.uid() OR m.user_id::text = NULLIF(current_setting(''app.current_user_id'', true), ''''))' ||
      ') WITH CHECK (' ||
      'organization_id::text = NULLIF(current_setting(''app.current_org_id'', true), '''') ' ||
      'OR organization_id IN (SELECT m.organization_id FROM public.memberships m ' ||
      'WHERE m.user_id = auth.uid() OR m.user_id::text = NULLIF(current_setting(''app.current_user_id'', true), ''''))' ||
      ')', table_name
    );
  END LOOP;
END $$;

ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_secrets_tenant_isolation ON public.integration_secrets
  USING (
    organization_id IN (
      SELECT m.organization_id FROM public.memberships m
      WHERE m.user_id = auth.uid()
        OR m.user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
    )
    OR organization_id::text = NULLIF(current_setting('app.current_org_id', true), '')
  )
  WITH CHECK (
    organization_id IN (
      SELECT m.organization_id FROM public.memberships m
      WHERE m.user_id = auth.uid()
        OR m.user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
    )
    OR organization_id::text = NULLIF(current_setting('app.current_org_id', true), '')
  );

-- The browser never receives provider credentials. It only receives ciphertext
-- through the authenticated server route; the encryption key remains on the VPS.
REVOKE ALL ON SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
