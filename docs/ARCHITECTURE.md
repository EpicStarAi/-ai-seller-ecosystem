# System Architecture

## Decision
Start with a modular monolith and separately scalable worker processes. Extract services only when measured scale, team boundaries or isolation needs justify it.

## Components
- Web app: tenant console, CRM, inbox, funnel builder, admin and billing.
- FastAPI: authentication context, authorization, validation and domain services.
- Domain modules: identity, tenancy, CRM, messaging, funnels, agents, campaigns, billing and analytics.
- AI Gateway: provider adapters, capability registry, routing policy, retries and usage normalization.
- Agent Runtime: state machine, tool registry, budget enforcement, approval gates and traces.
- Workers: webhook processing, scheduled jobs, campaign dispatch, AI jobs and analytics aggregation.
- PostgreSQL: system of record. Redis: cache, locks and task broker, not source of truth.
- Object storage: uploads, exports and generated assets.
- Observability: OpenTelemetry traces, structured logs, metrics and alerts.

## Multi-tenancy
Every tenant-owned row has organization_id. API derives tenant context from authenticated membership; never trust a client-supplied organization ID without authorization. RLS is defense in depth. Set tenant context transaction-locally and use a non-owner runtime DB role. Add automated cross-tenant denial tests.

## AI Gateway
Request envelope: tenant_id, actor_id, request_id, task type, data classification, provider/model preference, input, tool definitions, output budget, timeout and cost ceiling.

Adapters handle native auth/serialization, capabilities, streaming, normalized errors and usage metadata. Keep native APIs where feature parity is incomplete; do not force all providers into an OpenAI-compatible schema. Routing must enforce data policy, model allowlists, budgets and bounded retries. Never silently downgrade safety or tool permissions.

## Agent Runtime
Agent versions are immutable after publication. Every run references exact agent version, input snapshot, policy version and model route. Tools are server-side allowlisted; no arbitrary shell or unrestricted URL fetch. Enforce step/time/token/cost/concurrency limits. High-impact actions require human approval. Persist checkpoints for safe resume.

## Event execution
Use transactional outbox: write domain state and event atomically, dispatch to queue, deduplicate consumers, retry with bounded exponential backoff and jitter, move poison messages to DLQ and alert operators.

## Cloud deployment
Managed PostgreSQL, managed Redis, containerized API/workers, object storage, secrets manager, private networking, TLS/WAF and centralized telemetry. Select cloud vendor/region only after compliance, latency and budget review; codify infrastructure before production.

## Scaling
Scale API and workers independently. Partition high-volume tables only after measuring. Extract AI execution, messaging dispatch or analytics only when justified by operational evidence.
