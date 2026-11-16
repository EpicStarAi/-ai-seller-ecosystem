# Test Strategy

## Layers
- Unit: domain rules, authorization, provider adapters, billing calculations.
- Integration: PostgreSQL constraints/RLS, Redis, storage, Telegram webhook verification.
- Contract: OpenAPI schemas and provider adapter behavior.
- E2E: organization onboarding, connect bot, inbound message, operator reply, AI draft, funnel handoff.
- Security: cross-tenant access, IDOR, secret exposure, webhook replay, rate-limit bypass, prompt injection/tool misuse.
- Performance: API latency, webhook throughput, queue lag, agent concurrency and DB contention.
- Resilience: provider timeout/rate limit, worker crash, duplicate event, retry exhaustion and DLQ replay.

## Mandatory negative tests
1. Tenant A cannot read tenant B contact by guessed UUID.
2. Operator cannot change billing or organization owner.
3. Replayed Telegram update does not create duplicate message.
4. Agent cannot call a tool outside allowlist or exceed run budget.
5. Opted-out contact is excluded from outbound campaign.
6. Provider timeout cannot cause duplicate ledger charge.
7. Secret never appears in API responses or logs.

Every release records test run, commit SHA, migration status, dependency scan, security findings and rollback plan.
