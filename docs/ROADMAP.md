# Development Roadmap

## Gate 0 — Product baseline
- [x] Product direction and SaaS decisions recorded
- [x] Initial architecture, data model and API outline documented
- [ ] Select cloud provider/region and budget
- [ ] Validate privacy/legal requirements for target markets
- [ ] Verify competitor features and API access

## Gate 1 — Platform foundation
- [ ] Branch protection, CI, lint, unit tests and dependency scanning
- [ ] Infrastructure-as-code and dev/staging environments
- [ ] Managed identity, organizations, memberships and RBAC
- [ ] Tenant RLS with cross-tenant negative tests
- [ ] Audit log and request correlation

## Gate 2 — Messaging and CRM
- [ ] Telegram Bot API connection and webhook verification
- [ ] Idempotent update ingestion and background processing
- [ ] Contacts, conversations, messages and shared inbox
- [ ] Human operator reply and handoff
- [ ] Consent, suppression and frequency controls

## Gate 3 — AI platform
- [ ] AI Gateway and capability registry
- [ ] OpenAI, Anthropic and Gemini adapters
- [ ] Provider contract tests and normalized errors
- [ ] Usage/cost metering and tenant budgets
- [ ] Agent versioning, tools, checkpoints and approval gates

## Gate 4 — Funnels and automation
- [ ] Versioned funnel graph and schema validation
- [ ] Durable workflow state and retry semantics
- [ ] Human handoff and failure recovery
- [ ] Scheduler, event outbox and dead-letter handling

## Gate 5 — Commercial SaaS
- [ ] Plans, entitlements and subscription lifecycle
- [ ] Immutable ledger and reconciliation
- [ ] Usage dashboard and invoice integration
- [ ] Admin console and support tooling

## Gate 6 — Beta readiness
- [ ] Cross-tenant penetration tests
- [ ] Load/soak tests and backup restore drill
- [ ] Incident response and alerting
- [ ] Privacy/export/deletion verification
- [ ] Pilot customer acceptance

A gate is complete only when acceptance tests pass and evidence is recorded.
