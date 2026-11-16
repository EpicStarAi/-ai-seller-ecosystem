# Identity and Tenant Isolation — Implementation Notes

## Authentication contract
The API accepts OIDC access tokens signed with RS256. Configure `AUTH_JWKS_URL`, `AUTH_ISSUER` and `AUTH_AUDIENCE`. The API validates signature, issuer, audience, expiry and required claims. It does not issue passwords or local login tokens; identity lifecycle belongs to the configured identity provider.

## Organization lifecycle
- Organization creation maps the stable OIDC `sub` to a local user.
- Organization creation atomically creates the organization, initial owner membership and audit event.
- Organization listing returns only memberships belonging to the authenticated subject.
- Slugs are globally unique in this first iteration.

## Database enforcement
Migration 002 enables and forces RLS on tenant-owned tables. Tenant access is scoped by transaction-local PostgreSQL settings: `app.current_user_id`, `app.current_auth_subject` and `app.current_org_id`. The API sets these values inside the same transaction as protected queries.

The local bootstrap creates a dedicated `app_runtime` role with `NOBYPASSRLS`; API connections use this role, not the migration/bootstrap superuser. Production must use a dedicated non-owner, non-superuser runtime role with no `BYPASSRLS`. Migration owner and runtime credentials must be separate.

## Endpoints
- `GET /organizations` — list organizations for the authenticated user.
- `POST /organizations` — create an organization; creator becomes owner.

## Verification
Unit tests cover fail-closed OIDC configuration and role checks. PostgreSQL integration test `test_runtime_role_cannot_read_or_write_another_tenant` checks cross-tenant SELECT and INSERT isolation when `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` are configured. The test database must have both migrations applied; admin URL seeds fixtures, runtime URL must authenticate as the restricted role.

## Current limitations
- No user invitation/acceptance flow yet.
- No membership role-management endpoints yet.
- No production identity provider configured.
- PostgreSQL RLS integration test has not been executed against a live database in this development session.
