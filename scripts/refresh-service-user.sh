#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
# refresh-service-user.sh
#
# Fetches the SoundCloud service user's OAuth tokens from
# the production Convex deployment and sets them as Convex
# env vars on the dev deployment via `npx convex env set`.
#
# Run this when the dev service user tokens expire:
#   bun run refresh:service-user
#
# Requires:
#   - ANALYSIS_SERVICE_SECRET in .env.local
#   - CONVEX_SITE_URL in .env.local (production)
#   - SOUNDCLOUD_USER_ID in .env.local (e.g. 23625673)
#   - logged into Convex CLI
# ─────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$ROOT/.env.local"

load_env() {
  local key="$1"
  if [ -f "$ENV" ]; then
    grep -E "^${key}=" "$ENV" | tail -1 | sed "s/^${key}=//"
  fi
}

SECRET="$(load_env ANALYSIS_SERVICE_SECRET)"
PROD_SITE="$(load_env CONVEX_SITE_URL)"
USER_ID="$(load_env SOUNDCLOUD_USER_ID)"

if [ -z "$SECRET" ]; then echo "❌ ANALYSIS_SERVICE_SECRET not found in .env.local" >&2; exit 1; fi
if [ -z "$PROD_SITE" ]; then echo "❌ CONVEX_SITE_URL not found in .env.local" >&2; exit 1; fi
if [ -z "$USER_ID" ]; then echo "❌ SOUNDCLOUD_USER_ID not found in .env.local" >&2; exit 1; fi

echo "🔑 Fetching service user tokens from production ($PROD_SITE) ..."

RESPONSE="$(curl -s -X POST "${PROD_SITE}/soundcloud/service-credentials" \
  -H "authorization: Bearer ${SECRET}" \
  -H "content-type: application/json" \
  -d "{\"soundcloudUserId\":\"${USER_ID}\"}")"

ACCESS_TOKEN="$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || true)"
REFRESH_TOKEN="$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('refreshToken',''))" 2>/dev/null || true)"

if [ -z "$ACCESS_TOKEN" ]; then
  ERR="$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error','unknown error'))" 2>/dev/null || echo "$RESPONSE")"
  echo "❌ Failed to fetch credentials from production: $ERR" >&2
  exit 1
fi

echo "✅ Got tokens (access: ${#ACCESS_TOKEN} chars, refresh: ${#REFRESH_TOKEN} chars)"
echo "🌱 Setting as Convex env vars on dev deployment ..."

cd "$ROOT"
npx convex env set SOUNDCLOUD_SERVICE_USER_ACCESS_TOKEN "$ACCESS_TOKEN"
if [ -n "$REFRESH_TOKEN" ]; then
  npx convex env set SOUNDCLOUD_SERVICE_USER_REFRESH_TOKEN "$REFRESH_TOKEN"
fi

echo ""
echo "✅ Done! Dev service user tokens refreshed."
echo "   Refreshed at: $(date)"
