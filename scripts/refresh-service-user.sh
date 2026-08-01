#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
# refresh-service-user.sh
#
# Fetches the SoundCloud service user's OAuth tokens from
# the production Convex deployment, refreshes them via
# SoundCloud's OAuth endpoint, and sets the fresh tokens
# as Convex env vars on the dev deployment.
#
# Run this when the dev service user tokens expire:
#   bun run refresh:service-user
#
# Requires:
#   - ANALYSIS_SERVICE_SECRET in .env.local
#   - CONVEX_SITE_URL in .env.local (production)
#   - SOUNDCLOUD_USER_ID in .env.local (e.g. 23625673)
#   - CLIENT_ID / SOUNDCLOUD_CLIENT_ID in .env.local
#   - CLIENT_SECRET / SOUNDCLOUD_CLIENT_SECRET in .env.local
#   - logged into Convex CLI
# ─────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$ROOT/.env.local"

load_env() {
  local key="$1"
  if [ -f "$ENV" ]; then
    grep -E "^${key}=" "$ENV" | tail -1 | sed "s/^${key}=//" || true
  fi
}

SECRET="$(load_env ANALYSIS_SERVICE_SECRET)"
# Production Convex site URL (where the real SoundCloud auth account lives).
# Override with CONVEX_PROD_SITE in .env.local if different.
PROD_SITE="$(load_env CONVEX_PROD_SITE)"
if [ -z "$PROD_SITE" ]; then
  PROD_SITE="https://descriptive-mule-702.convex.site"
fi
USER_ID="$(load_env SOUNDCLOUD_USER_ID)"
CLIENT_ID="$(load_env CLIENT_ID)"
CLIENT_SECRET="$(load_env CLIENT_SECRET)"

if [ -z "$SECRET" ]; then echo "❌ ANALYSIS_SERVICE_SECRET not found in .env.local" >&2; exit 1; fi
if [ -z "$PROD_SITE" ]; then echo "❌ CONVEX_SITE_URL not found in .env.local" >&2; exit 1; fi
if [ -z "$USER_ID" ]; then echo "❌ SOUNDCLOUD_USER_ID not found in .env.local" >&2; exit 1; fi
if [ -z "$CLIENT_ID" ]; then CLIENT_ID="$(load_env SOUNDCLOUD_CLIENT_ID)"; fi
if [ -z "$CLIENT_SECRET" ]; then CLIENT_SECRET="$(load_env SOUNDCLOUD_CLIENT_SECRET)"; fi
if [ -z "$CLIENT_ID" ]; then echo "❌ CLIENT_ID not found in .env.local" >&2; exit 1; fi
if [ -z "$CLIENT_SECRET" ]; then echo "❌ CLIENT_SECRET not found in .env.local" >&2; exit 1; fi

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

# Try to refresh via SoundCloud's OAuth endpoint to get a definitely-fresh token.
if [ -n "$REFRESH_TOKEN" ]; then
  echo "♻️  Refreshing via SoundCloud OAuth ..."
  AUTH="$(echo -n "${CLIENT_ID}:${CLIENT_SECRET}" | base64)"
  REFRESH_RESPONSE="$(curl -s -X POST "https://secure.soundcloud.com/oauth/token" \
    -H "Authorization: Basic ${AUTH}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=refresh_token&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&refresh_token=${REFRESH_TOKEN}")"

  FRESH_ACCESS="$(echo "$REFRESH_RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)"
  FRESH_REFRESH="$(echo "$REFRESH_RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('refresh_token',''))" 2>/dev/null || true)"

  if [ -n "$FRESH_ACCESS" ]; then
    ACCESS_TOKEN="$FRESH_ACCESS"
    echo "   Fresh access: ${#ACCESS_TOKEN} chars"
    if [ -n "$FRESH_REFRESH" ]; then
      REFRESH_TOKEN="$FRESH_REFRESH"
      echo "   Fresh refresh: ${#REFRESH_TOKEN} chars"
    fi
  else
    ERR_MSG="$(echo "$REFRESH_RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || true)"
    echo "⚠️  Refresh failed ($ERR_MSG) — setting current tokens as-is."
  fi
fi

echo "🌱 Setting as Convex env vars on dev deployment ..."

cd "$ROOT"
npx convex env set SOUNDCLOUD_SERVICE_USER_ACCESS_TOKEN "$ACCESS_TOKEN"
if [ -n "$REFRESH_TOKEN" ]; then
  npx convex env set SOUNDCLOUD_SERVICE_USER_REFRESH_TOKEN "$REFRESH_TOKEN"
fi

echo ""
echo "✅ Done! Dev service user tokens refreshed."
echo "   Refreshed at: $(date)"
