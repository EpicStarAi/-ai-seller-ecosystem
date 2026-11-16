-- Identity metadata and database-enforced tenant isolation.
-- Runtime connections must use a non-superuser, non-BYPASSRLS role.
ALTER TABLE organizations
  ADD COLUMN created_by_user_id uuid REFERENCES users(id);

CREATE INDEX idx_organizations_creator ON organizations(created_by_user_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_select_self ON users
  FOR SELECT USING (
    auth_subject = NULLIF(current_setting('app.current_auth_subject', true), '')
    OR id::text = NULLIF(current_setting('app.current_user_id', true), '')
  );
CREATE POLICY users_insert_self ON users
  FOR INSERT WITH CHECK (
    auth_subject = NULLIF(current_setting('app.current_auth_subject', true), '')
  );
CREATE POLICY users_update_self ON users
  FOR UPDATE USING (
    auth_subject = NULLIF(current_setting('app.current_auth_subject', true), '')
  ) WITH CHECK (
    auth_subject = NULLIF(current_setting('app.current_auth_subject', true), '')
  );

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_select_member ON organizations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
    )
  );
CREATE POLICY organizations_insert_creator ON organizations
  FOR INSERT WITH CHECK (
    created_by_user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
  );
CREATE POLICY organizations_update_admin ON organizations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
        AND m.role IN ('owner', 'admin')
    )
  );

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_select_self_or_tenant ON memberships
  FOR SELECT USING (
    user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
    OR organization_id::text = NULLIF(current_setting('app.current_org_id', true), '')
  );
CREATE POLICY memberships_insert_owner_bootstrap_or_admin ON memberships
  FOR INSERT WITH CHECK (
    (
      user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
      AND role = 'owner'
      AND EXISTS (
        SELECT 1 FROM organizations o
        WHERE o.id = memberships.organization_id
          AND o.created_by_user_id = memberships.user_id
      )
    )
    OR EXISTS (
      SELECT 1 FROM memberships actor
      WHERE actor.organization_id = memberships.organization_id
        AND actor.user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
        AND actor.role IN ('owner', 'admin')
    )
  );
CREATE POLICY memberships_update_admin ON memberships
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM memberships actor
      WHERE actor.organization_id = memberships.organization_id
        AND actor.user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
        AND actor.role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships actor
      WHERE actor.organization_id = memberships.organization_id
        AND actor.user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
        AND actor.role IN ('owner', 'admin')
    )
  );

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workspaces', 'projects', 'integrations', 'contacts', 'conversations',
    'messages', 'agents', 'agent_versions', 'agent_runs', 'funnels',
    'funnel_versions', 'subscriptions', 'ledger_entries', 'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ' ||
      '(organization_id::text = NULLIF(current_setting(''app.current_org_id'', true), '''')) ' ||
      'WITH CHECK ' ||
      '(organization_id::text = NULLIF(current_setting(''app.current_org_id'', true), ''''))',
      table_name
    );
  END LOOP;
END $$;

-- Fail closed: an unset/empty organization context matches no tenant-owned row.
