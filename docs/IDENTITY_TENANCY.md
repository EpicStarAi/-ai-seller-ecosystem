# Identity and Tenant Isolation — Implementation Notes

## Authentication contract
The API accepts OIDC access tokens signed with RS256. Configure the issuer, audience and JWKS URL. The API validates signature, issuer, audience, expiry and required claims. It does not issue passwords or local login tokens; identity lifecycle belongs to the configured identity provider.

## Organization lifecycle
- First authenticated request may create a local user mapping from the stable OIDC `sub`.
- Organization creation atomically creates the organization, initial owner membership and audit event.
- Organization listing returns only memberships belonging to the authenticated subject.
- Slugs are globally unique in this first iteration.

## Database enforcement
Migration 002 enables and forces RLS on tenant-owned tables. Tenant access is scoped by transaction-local PostgreSQL settings: `app.current_user_id`, `app.current_auth_subject` and `app.current_org_id`. The API must set these values inside the same transaction as protected queries.

**Critical deployment requirement:** do not run the API using a superuser or a role with BYPASSRLS. Use a dedicated non-owner runtime role with only required grants. The bootstrap Docker Compose database user is for local development only and must not be used as a production credential. Verify all RLS behavior against PostgreSQL before beta.

## Current limitations
- No user invitation/acceptance flow yet.
- No membership role-management endpoints yet.
- No production identity provider configured.
- Cross-tenant PostgreSQL integration tests require a disposable PostgreSQL test database and are not run by the default unit-test suite.
