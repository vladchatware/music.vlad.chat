# Worker Deploy Handoff — Token Lifecycle + v8 Re-analysis

## Why

The analysis worker has been running on dead SoundCloud tokens. Root cause chain:

1. SoundCloud **refresh tokens are single-use** — every refresh returns a new
   refresh token. `soundcloud.ts` kept the rotated token **in memory only**;
   the DB kept the consumed one → `invalid_grant` on the next refresh.
2. Several independent processes (worker, backroom page, stream resolver)
   refresh separately → the first rotation invalidates the token for the rest.
3. On refresh failure the old code **silently fell back to client-credentials
   grant** → app token → **preview-only streams** → the worker "analyzed"
   30s previews (see `2117028168`: 29.8s analyzed of a 136s track) and ran
   very short jobs.
4. Queue claims attached the user's stored (usually expired) access token to
   each job; the worker preferred it → instant 401 → defer loop.

## What changed (branch `next`, uncommitted)

- `convex/http.ts` — new `POST /soundcloud/service-access-token`
  (secret-authorized): hands out the stored access token; `rotate: true`
  refreshes **and persists** the new pair via
  `users.updateServiceSoundcloudTokens`. The refresh token never leaves the
  server.
- `convex/users.ts` — `updateServiceSoundcloudTokens` internal mutation.
- `convex/trackAnalysis.ts` — queue claims **no longer attach access tokens**.
- `workers/track-analysis/index.ts` — worker fetches tokens from the endpoint
  (no more shared in-memory credentials, no client-credentials preview
  fallback); on auth-type job failure it rotates, then requeues.
- `workers/track-analysis/processJob.ts` — `[PREVIEW_DECODE]` guard: fails the
  job when decoded audio is < 90% of track duration.
- `app/api/tracks/[id]/stream/streamResolver.ts` + backroom page — use the
  endpoint, rotate+retry once on SoundCloud 401.
- `app/api/tracks/[id]/transitions/route.ts` — v7 fallback ladder (same as the
  analysis endpoint).
- `app/api/tracks/[id]/transitions/candidates/route.ts` — NEW: ranked
  candidates for a track (used by the media render pipeline).

## Deploy order (matters)

### 0. Prod Convex env (one-time)

```bash
npx convex env set SOUNDCLOUD_CLIENT_ID "$CLIENT_ID"        # prod deployment: descriptive-mule-702
npx convex env set SOUNDCLOUD_CLIENT_SECRET "$CLIENT_SECRET"
npx convex env set SOUNDCLOUD_USER_ID "23625673"
```

(`CLIENT_ID`/`CLIENT_SECRET` are in `.env.local`.)

### 1. Worker image FIRST, then Convex functions

```bash
git pull
docker compose -f workers/track-analysis/compose.yaml build --pull
docker compose -f workers/track-analysis/compose.yaml up -d
```

Worker `.env` needs: `ANALYSIS_SERVICE_SECRET`, `CONVEX_SITE_URL`
(= `https://descriptive-mule-702.convex.site`), `SOUNDCLOUD_CLIENT_ID`,
`SOUNDCLOUD_CLIENT_SECRET`.
The `SOUNDCLOUD_ACCESS_TOKEN` / `SOUNDCLOUD_REFRESH_TOKEN` /
`SOUNDCLOUD_ACCESS_TOKEN_EXPIRES_AT` compose entries are now **unused** — the
worker no longer holds refresh tokens at all. Remove them.

Then deploy Convex functions to prod:

```bash
npx convex deploy   # targets descriptive-mule-702; confirm the prompt
```

⚠️ Order matters: Convex claims stop carrying tokens; a worker build older
than this change would fall back to its client-credentials preview path for
tokenless jobs. Worker first (or same maintenance window).

### 2. Music Next.js app

Deploy `next` as usual (stream resolver, backroom page, transitions API
fallback, candidates endpoint).

### 3. Re-queue the two bad analyses

```bash
curl -X POST "https://music.vlad.chat/api/tracks/2117028168?force=true"   # preview-only analysis
curl -X POST "https://music.vlad.chat/api/tracks/2372052680?force=true"   # never completed
```

### 4. Verify

```bash
# worker log: completed jobs with sane processing times (≥ a few seconds per
# minute of audio; no instant 401 loops)
docker compose -f workers/track-analysis/compose.yaml logs -f analysis-worker

# stored version is v8 now (not v7)
curl -s https://music.vlad.chat/api/tracks/2117028168/analysis | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(d['analysisVersion'], round(d['durationSec'],1))"

# duration matches the real track (not ~30s)

# transitions work across the v7/v8 boundary
curl -s "https://music.vlad.chat/api/tracks/1925340764/transitions?with=2117028168&arc=preserve" | head -c 200
```

## Token lifecycle after this deploy

- Access tokens still expire (~1h) — that's normal.
- Refresh now works automatically: on 401, consumers ask the endpoint to
  rotate; the new refresh token is persisted, so nothing goes stale.
- The manual `scripts/refresh-service-user.sh` / manual re-login dance should
  no longer be needed. If `invalid_grant` reappears, it means two rotations
  raced — re-login once to reseed.
- Rotation persistence requires the **DB path** (service user account). The
  `SOUNDCLOUD_SERVICE_USER_ACCESS_TOKEN` env override (dev deployment) can't
  persist rotations — leave it unset on prod.
