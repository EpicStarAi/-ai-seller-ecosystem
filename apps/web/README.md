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

## Supabase Auth setup

Set these public variables in `.env.local` and the production service environment:

- `NEXT_PUBLIC_SITE_URL` (`https://seller.puseta.website` in production)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

In Supabase Dashboard → Authentication → URL Configuration:
- Set Site URL to `https://seller.puseta.website`.
- Add `https://seller.puseta.website/auth/callback` to Redirect URLs.
- For local development, also add `http://localhost:3000/auth/callback`.

The application uses `@supabase/ssr` with cookie-based PKCE sessions. Protected routes are checked in Next.js 15 middleware with `auth.getClaims()`. The browser uses only the publishable key. Never expose a secret/service-role key through a `NEXT_PUBLIC_` variable.

## Current scope

- Responsive personal workspace shell and navigation.
- Email/password sign-up and sign-in.
- Cookie-based SSR session refresh and protected workspace routes.
- Sign-out endpoint.
- Demo AI chat, agent configuration, CRM contacts, workflow toggles and funnel preview remain client-side prototypes.
- No AI provider, Telegram, or persistent business data integration yet.

## Important

Authentication is connected to Supabase Auth, but organization provisioning and the FastAPI organization API are not yet wired into the signup flow. Do not enter provider API keys in the browser.
