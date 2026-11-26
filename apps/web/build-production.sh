#!/usr/bin/env bash
# Production Next.js build: ensure public Supabase credentials are available at compile time.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SUPABASE_ENV_FILE:-/etc/ai-seller-web.env}"
if [[ ! -r "$ENV_FILE" ]]; then
  echo "ERROR: Supabase environment file not readable: $ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${NEXT_PUBLIC_SUPABASE_URL:?Missing NEXT_PUBLIC_SUPABASE_URL in $ENV_FILE}"
: "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in $ENV_FILE}"
cd "$ROOT"
npm run build
