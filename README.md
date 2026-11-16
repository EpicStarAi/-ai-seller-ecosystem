# AI Seller Ecosystem

Commercial multi-tenant SaaS for Telegram-first sales automation, CRM, funnels and governed AI agents.

**Status:** foundation scaffold; not production-ready.
**Architecture:** modular monolith + event-driven workers.
**Baseline:** FastAPI, PostgreSQL, Redis, Docker; multi-provider AI gateway (OpenAI, Anthropic Claude, Google Gemini).

## Product principles
- Tenant isolation enforced server-side and at database layer.
- Provider-neutral AI interface with native adapters for provider-specific capabilities.
- Permissioned tools, budgets, approval gates and audit trails for AI agents.
- Telegram integrations use supported official interfaces and consent-aware messaging.
- Append-only usage/financial records; secrets never committed to source control.

## Repository map
- `apps/api`: FastAPI foundation
- `infra/postgres/migrations`: database migrations
- `infra/docker-compose.yml`: local dependencies and API
- `docs/`: PRD, architecture, API, security, testing and roadmap
- `packages/ai_gateway`: provider adapter contract

## Local development
1. Copy `.env.example` to `.env`; replace local-only passwords.
2. Run `docker compose -f infra/docker-compose.yml up --build`.
3. Check `http://localhost:8000/health` and `/docs`.

The initial API only exposes health/version endpoints. Authentication, tenant provisioning, Telegram webhook processing, billing and AI execution are not implemented yet.

## Release gates
Do not deploy publicly before implementing auth/RBAC, tenant-scoped queries and RLS, verified webhook ingestion, secret management, usage accounting, backups, observability, security tests and load tests. See `docs/ROADMAP.md`.
