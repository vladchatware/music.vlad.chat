#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../workers/track-analysis"

echo ":: Starting analysis worker and Cloudflare quick tunnel..."
docker compose up -d --wait

echo ":: Waiting for cloudflared to report tunnel URL..."
URL=""
for i in $(seq 1 30); do
  URL=$(docker compose logs cloudflared 2>/dev/null \
    | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' \
    | tail -1)
  if [ -n "$URL" ]; then break; fi
  sleep 2
done

if [ -z "$URL" ]; then
  echo "ERROR: Could not detect tunnel URL from cloudflared logs." >&2
  echo "       Check 'docker compose logs cloudflared' manually." >&2
  exit 1
fi

echo ":: Tunnel URL: $URL"
echo ":: Updating Vercel environment variable ANALYSIS_WORKER_URL..."

if [ -n "${VERCEL_TOKEN:-}" ]; then
  echo "$URL" | npx vercel env add ANALYSIS_WORKER_URL production \
    --token "$VERCEL_TOKEN" --yes 2>/dev/null \
    || echo "WARNING: Vercel env update failed. Set manually:"
else
  echo ""
  echo "   Run this to set it manually:"
  echo ""
  echo "   echo '$URL' | npx vercel env add ANALYSIS_WORKER_URL production"
  echo ""
fi

echo ":: Done. Worker reachable at $URL"