# Security Architecture

## Identity and access
Use managed OIDC-compatible identity. Validate issuer, audience, signature, expiry and authorized party. Resolve memberships server-side. Enforce RBAC plus resource-level authorization. API keys are scoped, hashed at rest, revocable and shown once.

## Tenant isolation
All tenant-owned rows include organization_id. Set tenant context transaction-locally only after membership verification. Enable RLS for every tenant table and test using a non-owner runtime role. Frontend filtering is never a security boundary.

## Secrets
Use cloud secrets manager or envelope-encrypted vault. Database stores secret references, not plaintext credentials. Support rotation, revocation and access logging. Never place secrets in logs, prompts, analytics or API responses.

## AI governance
Treat user content, retrieved documents and tool output as untrusted. Tools are server-side allowlisted. Apply tenant budgets, run limits, data classification and model allowlists. Require human approval for high-impact outbound actions. Audit policy version, tool calls, outcome and usage while minimizing sensitive content.

## Messaging
Use supported official APIs. Require appropriate consent/legal basis for outbound campaigns. Enforce opt-out, suppression lists, frequency caps and auditability. Verify Telegram webhook secret token and deduplicate updates.

## Operations
TLS, encryption at rest, managed backups and restore tests. Dependency/secret/container scanning, SAST, incident response, retention schedules and data export/deletion.
