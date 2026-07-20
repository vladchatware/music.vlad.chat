# LiveKit RTMPS encoder worker

Self-hosted media stack for browser WebRTC to Instagram RTMPS:

```text
music.vlad.chat browser
        │ WebRTC
        ▼
LiveKit server ── Redis ── LiveKit Egress
                              │ H.264/AAC RTMPS
                              ▼
                           Instagram
```

This stack owns media transport only. Instagram owns announcement, public Live start, and Live end.

## Local setup

Requirements: Docker with Compose, at least 4 CPU and 4 GB memory available for each active Egress transcode.

```bash
cp workers/live-egress/.env.example workers/live-egress/.env
openssl rand -hex 8
openssl rand -hex 32
```

Put first value in `LIVEKIT_API_KEY`; second in `LIVEKIT_API_SECRET`. Then:

```bash
bun run live:infra:validate
bun run live:infra:up
bun run live:infra:logs
```

Configure Next.js with matching values:

```dotenv
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Open `/live-studio`, connect encoder, then watch Egress logs. Health endpoints:

- LiveKit HTTP/API: `http://localhost:7880`
- Egress health: `http://localhost:8081`
- Egress Prometheus: `http://localhost:9091/metrics`

Stop stack:

```bash
bun run live:infra:down
```

## Public deployment

Compose file is local/single-host baseline, not complete Internet edge configuration. Public deployment additionally needs:

- trusted TLS and public `wss://` endpoint for port 7880;
- public `LIVEKIT_NODE_IP`;
- inbound TCP 7881 and UDP 7882 firewall rules;
- TURN/TLS for networks blocking direct ICE;
- Redis kept private; never publish port 6379;
- worker monitoring and at least one Egress instance per expected concurrent composite job.

LiveKit recommends host networking for production SFU performance. Use official VM config generator when deploying public edge; merge Egress service against same Redis and API credentials.

## Security

- `.env` is ignored by repository root `.gitignore`.
- RTMPS destination exists only in Egress request memory.
- Egress health and metrics bind to host loopback.
- Redis has protected mode disabled only inside unexposed Docker network.
