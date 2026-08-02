# Headless DJ Bench

Duration-driven agent bench. Real SoundCloud discovery and cached analysis come
from local MCP endpoint. Decks, playback clock, transitions, and failures are
simulated. Default run must construct 90 minutes of continuous virtual audio.

This bench does not measure musical quality.

Regular-player failures are release gates, not anecdotes. Add each incident to
this same `revibe` run under a stable failure ID. The bench must first reproduce
the old outcome with mocked browser response boundaries, serialization, timing,
and playback deadline, then prove the current production policy reaches a safe
player action. `ok: true` is forbidden when any tracked playthrough is unresolved.

Each episode now starts with a real liked track whose cached analysis is ready.
The audio engine remains mocked, but outgoing metadata, tempo, duration, key,
energy, sections, and cue evidence are live MCP data.

Cross-turn model memory is deliberately compact: current decks, queued/accepted
transition, played IDs, recent execution outcomes, and current user direction.
Raw discovery, analysis payloads, and reasoning remain in trace/cache only.
Discovery now queues candidate analysis ahead, matching production behavior.
Keep analysis worker running externally during bench runs; bench never waits or
polls, and reports how many accepted transitions had ready incoming analysis.

## Run

Start application:

```sh
bun run dev
```

Run 90-minute virtual set:

```sh
bun run bench:dj
```

Change duration or transition safety ceiling:

```sh
bun run bench:dj --duration-min 120 --max-transitions 64
```

Simulation jumps between planning windows. It does not wait 90 wall-clock
minutes. Every accepted plan records both global set time and local source-track
time so browser audition can reconstruct any timestamp.

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
- `manifest.json` — seekable set/source mapping, transitions, model text,
  provider-returned reasoning, messages, tool calls, results, and failures.

Open `/bench` in local app to browse runs. Inspector supports timestamp seeking,
fresh SoundCloud audio audition, transition replay, and synchronized AI evidence.
Reasoning is shown only when provider returned it.

List recent reports:

```sh
bun run bench:dj:reports
```

This regenerates `logs/dj-bench/benchmark.html`, aggregate benchmark dashboard
across stored episodes. Dashboard separates infrastructure failures from model
performance and includes model/config comparison, continuity survival,
coherence trajectory, failure taxonomy, tokens, and per-run drill-down.

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

`/bench`, `/bench/[runId]`, and configured MCP endpoint are intentional public
surfaces. Run artifacts may expose model text, reasoning, tool evidence, and
track metadata, so never place credentials in prompts, MCP URLs, or trace data.
MCP URL is stored verbatim for reproducibility because endpoint itself is public.

## Success boundary

`ok: true` means duration and mechanical contract held:

- state inspected;
- likes and search used;
- analysis inspected;
- newly discovered candidates queued for future analysis;
- requested set duration covered without a gap;
- accepted tracks unique;
- completed dwell times meet `MIN_TRACK_DWELL_SEC` and body tracks meet `MIN_BODY_TRACK_DURATION_SEC`;
- no detected false success claim.

It does not mean selections or transitions sound good. Real-audio listening
review remains separate gate.
