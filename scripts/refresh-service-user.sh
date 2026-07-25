#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
# refresh-service-user.sh
#
# Fetches the SoundCloud service user's OAuth tokens from
# the production Convex deployment and seeds them into the
# local dev deployment so the /me page works without OAuth.
#
# Run this when the dev service user tokens expire.
#
# Requires:
#   - ANALYSIS_SERVICE_SECRET in .env.local (to auth against Convex)
#   - CONVEX_SITE_URL in .env.local (production site URL)
#   - SOUNDCLOUD_USER_ID in .env.local (e.g. 23625673)
#   - logged into Convex CLI
# ─────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$ROOT/.env.local"

# Load env vars we need
load_env() {
  local key="$1"
  if [ -f "$ENV" ]; then
    grep -E "^${key}=" "$ENV" | tail -1 | sed "s/^${key}=//"
  fi
}

SECRET="$(load_env ANALYSIS_SERVICE_SECRET)"
PROD_SITE="$(load_env CONVEX_SITE_URL)"
USER_ID="$(load_env SOUNDCLOUD_USER_ID)"

if [ -z "$SECRET" ]; then
  echo "❌ ANALYSIS_SERVICE_SECRET not found in .env.local" >&2
  exit 1
fi
if [ -z "$PROD_SITE" ]; then
  echo "❌ CONVEX_SITE_URL not found in .env.local" >&2
  exit 1
fi
if [ -z "$USER_ID" ]; then
  echo "❌ SOUNDCLOUD_USER_ID not found in .env.local" >&2
  exit 1
fi

echo "🔑 Fetching service user tokens from production ($PROD_SITE) ..."

RESPONSE="$(curl -s -X POST "${PROD_SITE}/soundcloud/service-credentials" \
  -H "authorization: Bearer ${SECRET}" \
  -H "content-type: application/json" \
  -d "{\"soundcloudUserId\":\"${USER_ID}\"}")"

ACCESS_TOKEN="$(echo "$RESPONSE" | sed -n 's/.*"accessToken"[[:space:]]*:[[:space:]]*"\(.*\)"[},].*/\1/p')"
REFRESH_TOKEN="$(echo "$RESPONSE" | sed -n 's/.*"refreshToken"[[:space:]]*:[[:space:]]*"\(.*\)"[},].*/\1/p')"

# Also try parsing with python if available (handles escaped chars properly)
if command -v python3 &>/dev/null; then
  ACCESS_TOKEN="$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "$ACCESS_TOKEN")"
  REFRESH_TOKEN="$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('refreshToken',''))" 2>/dev/null || echo "$REFRESH_TOKEN")"
fi

if [ -z "$ACCESS_TOKEN" ]; then
  ERR="$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error','unknown error'))" 2>/dev/null || echo "$RESPONSE")"
  echo "❌ Failed to fetch credentials from production: $ERR" >&2
  exit 1
fi

echo "✅ Got tokens (access: ${#ACCESS_TOKEN} chars, refresh: ${#REFRESH_TOKEN} chars)"
echo "🌱 Seeding into dev deployment ..."

cd "$ROOT"
npx convex run convex/seedServiceUser:patchServiceUser \
  "$(python3 -c "
import json
args = {
  'soundcloudUserId': '$USER_ID',
  'accessToken': '$ACCESS_TOKEN',
}
if '$REFRESH_TOKEN':
  args['refreshToken'] = '$REFRESH_TOKEN'
print(json.dumps(args))
")"

echo ""
echo "✅ Done! Service user tokens refreshed in dev deployment."
echo "   Refreshed at: $(date)"
