# Instagram Live studio spike

Studio route: `/live-studio`

## Runtime flow

1. Browser captures Three.js canvas at 30 FPS and DJ master mix through Web Audio.
2. Browser publishes video and audio to one LiveKit room over WebRTC.
3. LiveKit Egress worker transcodes participant to portrait H.264/AAC and sends it to supplied Instagram RTMPS destination.
4. Meta sends signed `live_comments` webhooks to Convex.
5. Convex deduplicates comments and updates realtime crowd presence.
6. Three.js creates one procedural dancer per commenter. Later comments update dance reaction.

RTMPS stream keys are sent only to authenticated Next.js start endpoint and LiveKit Egress. They are not persisted in Convex or returned to browser.

## Required configuration

Next.js environment:

```dotenv
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Convex environment:

```dotenv
INSTAGRAM_APP_SECRET=...
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=...
```

Configure Meta webhook callback as:

```text
https://YOUR_CONVEX_SITE_URL/instagram/webhook
```

Subscribe connected Instagram Professional account to `live_comments`. Current spike expects numeric Instagram account ID in studio. Meta account OAuth and automatic `/{ig_user_id}/subscribed_apps` setup remain deployment work; RTMPS credentials alone do not authorize comment webhooks.

LiveKit Cloud includes Egress. Self-hosted configuration lives in [`workers/live-egress`](../workers/live-egress/README.md) and includes LiveKit Server, Redis, and Egress. Use at least 4 CPU and 4 GB memory per composite worker.

## Local validation

Use comment simulator immediately; no broadcast or Instagram credentials required. First simulated comment lazily creates a preview session. Connecting encoder does not mark Instagram Live as started. First signed `live_comments` delivery changes detected platform status to `live`; Instagram remains lifecycle authority.

```bash
bun run test:run convex/liveStreams.test.ts lib/instagramLive.test.ts
bun run build
```

## Production follow-ups

- Add Instagram OAuth and verify account ownership instead of accepting account ID manually.
- Add LiveKit webhook reconciliation so disconnected egress always ends Convex session.
- Add session ownership persistence for operational dashboards.
- Add crowd LOD/instancing beyond 40 visible dancers.
