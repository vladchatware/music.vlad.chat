# Headless DJ Bench

Mechanical agent bench. Real SoundCloud discovery and cached analysis come from
the local MCP endpoint. Decks, playback clock, transitions, and failures are
simulated.

This bench does not measure musical quality.

Each episode now starts with a real liked track whose cached analysis is ready.
The audio engine remains mocked, but outgoing metadata, tempo, duration, key,
energy, sections, and cue evidence are live MCP data.

Cross-turn model memory is deliberately compact: current decks, queued/accepted
transition, played IDs, recent execution outcomes, and current user direction.
Raw discovery, analysis payloads, and reasoning remain in trace/cache only.

## Run

Start application:

```sh
bun run dev
```

Run five-transition episode:

```sh
bun run bench:dj
```

Use OpenCode Zen instead of Vercel AI Gateway:

```sh
OPENCODE_API_KEY="..." \
  bun run bench:dj --provider opencode --model gpt-5.6-terra
```

Key stays in environment and is never written to trace. `OPENCODE_BASE_URL`
can override default `https://opencode.ai/zen/v1`.

DeepSeek V4 Flash uses Zen's Chat Completions protocol:

```sh
OPENCODE_API_KEY="..." \
  bun run bench:dj --provider opencode --model deepseek-v4-flash
```

Pin a liked opener for reproducible runs:

```sh
bun run bench:dj --outgoing-id 2094321906
```

The pinned ID must appear in the fetched likes sample and have ready analysis.

Run intervention and recovery scenario:

```sh
bun run bench:dj \
  --scenario interventions \
  --fail stale-state,missing-analysis,unavailable-track \
  --clock-speed 4
```

Use `bun run bench:dj --help` for every option.

Each run gets a durable folder under `logs/dj-bench/`:

- `trace.jsonl` — complete event and tool timeline;
- `summary.json` — machine-readable verdict and metrics;
- `report.md` — Mermaid continuity timeline and coherence transition graph,
  followed by readable evidence tables;
- `config.json` — sanitized run settings; secrets never stored.

List recent reports:

```sh
bun run bench:dj:reports
```

This regenerates `logs/dj-bench/benchmark.html`, aggregate benchmark dashboard
across stored episodes. Dashboard separates infrastructure failures from model
performance and includes model/config comparison, continuity survival,
coherence trajectory, failure taxonomy, tokens, and per-run drill-down.

With the application running, open `/bench` to view the same dashboard without
regenerating the standalone file. Selecting an episode opens a styled flight
recorder at `/bench/runs/<run-id>` with transition evidence, contract counters,
tool activity, and a bounded event timeline. Markdown, JSONL, summary, and
config artifacts remain available as explicit downloads from that screen.

Stored artifact references are relative to their run folder. Web routes resolve
artifacts from the bench root and never trust or expose machine-specific
absolute paths.

Print latest report:

```sh
bun run bench:dj:reports --latest
```

`--trace /path/name.jsonl` keeps custom trace path and creates
`name.summary.json`, `name.report.md`, and `name.config.json` beside it.
Final JSON summary also goes to stdout. Event timeline goes to stderr.

## Data boundary

Real MCP mode returns likes, searches, and analysis to selected model. Run only
when that data egress is intended and authorized. Use `--cookie` only when
authenticated user-library access is required; never store cookie in trace.

## Success boundary

`ok: true` means mechanical contract held:

- state inspected;
- likes and search used;
- analysis inspected;
- requested transition count accepted;
- accepted tracks unique;
- no detected false success claim.

It does not mean selections or transitions sound good. Real-audio listening
review remains separate gate.
