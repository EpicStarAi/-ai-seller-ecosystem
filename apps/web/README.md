# AI Seller Ecosystem — Web Workspace

Next.js App Router frontend for the personal testing workspace.

## Run locally

```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000.

## Current scope

- Responsive personal workspace shell and navigation.
- Dashboard, demo AI chat, agent configuration, CRM contacts, workflow toggles and funnel preview.
- Integrations are explicitly marked as not connected.
- Demo interactions are client-side only and are not persisted.
- API base URL is reserved for the FastAPI integration phase.

## Important

This is a frontend prototype, not a production-ready application. It does not yet authenticate users, call AI providers, send Telegram messages, persist workspace data, or execute automations. Never enter API keys or production credentials into this prototype.