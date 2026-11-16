# AI Seller Ecosystem

Commercial multi-tenant SaaS for Telegram-first sales automation, CRM, funnels and governed AI agents.

**Status:** foundation + initial identity/tenant-isolation slice; not production-ready.
**Architecture:** modular monolith + event-driven workers.
**Baseline:** FastAPI, PostgreSQL, Redis, Docker; multi-provider AI gateway (OpenAI, Anthropic Claude, Google Gemini).

## Product principles
- Tenant isolation enforced server-side and at database layer.
- Provider-neutral AI interface with native adapters for provider-specific capabilities.
- Permissioned tools, budgets, approval gates and audit trails for AI agents.
- Telegram integrations use supported official interfaces and consent-aware messaging.
- Append-only usage/financial records; secrets never committed to source control.

## Repository map
- `apps/api`: FastAPI foundation and organization endpoints
- `infra/postgres/migrations`: ordered PostgreSQL bootstrap and migrations
- `infra/docker-compose.yml`: local dependencies and API
- `docs/`: PRD, architecture, API, security, testing and roadmap
- `packages/ai_gateway`: provider adapter contract

## Local development
1. Copy `.env.example` to `.env`.
2. Set `AUTH_JWKS_URL`, `AUTH_ISSUER` and `AUTH_AUDIENCE` for your OIDC provider.
3. Change local-only database passwords before use on a shared machine.
4. Run `docker compose -f infra/docker-compose.yml up --build`.
5. Check `http://localhost:8000/health` and `/docs`.

Protected endpoints require a valid OIDC access token. Implemented identity endpoints:
- `GET /organizations`
- `POST /organizations`

The API does not yet implement invitation management, membership administration, Telegram webhook processing, billing or AI execution.

## Security note
The local bootstrap creates a restricted `app_runtime` PostgreSQL role and enables row-level security through migrations. Production must use a dedicated non-owner, non-superuser role with no `BYPASSRLS`, managed credentials, and verified restore/security procedures.

## Release gates
Do not deploy publicly before configuring a production identity provider, validating RLS with the runtime role, completing authorization tests, verified webhook ingestion, secret management, usage accounting, backups, observability, security tests and load tests. See `docs/ROADMAP.md`.
