# Database Model

## Core entities
- organizations, users, memberships, workspaces, projects
- integrations, contacts, conversations, messages
- agents, agent_versions, agent_runs
- funnels, funnel_versions
- subscriptions, ledger_entries, audit_logs

## Relationships
Organizations own workspaces, projects, integrations, contacts, agents, funnels, subscriptions and ledger/audit records. Users join organizations through memberships. Contacts have conversations; conversations contain messages. Agents have immutable versions; versions have execution runs. Funnels have immutable published versions.

## Conventions
UUID primary keys; UTC timestamps; organization_id on every tenant-owned row; foreign keys and unique constraints; append-only financial ledger. PII requires classification, retention and deletion policy.

Initial SQL migration is in infra/postgres/migrations/001_initial.sql. RLS policies are a mandatory follow-up gate and must be tested with the non-owner runtime DB role and transaction-local tenant context.
