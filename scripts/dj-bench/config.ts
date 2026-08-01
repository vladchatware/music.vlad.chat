import { basename, dirname, extname, join, resolve } from "node:path";

import { DEFAULT_REVIBE_PROMPT } from "./prompt";

export const FAILURE_NAMES = [
  "reject-first",
  "missing-analysis",
  "unavailable-track",
  "late-decision",
  "stale-state",
  "mcp",
] as const;

export type FailureName = (typeof FAILURE_NAMES)[number];
export type BenchScenario = "revibe" | "interventions";
export type BenchProvider = "gateway" | "opencode";

export interface BenchConfig {
  provider: BenchProvider;
  model: string;
  targetDurationSec: number;
  transitions: number;
  timeoutMs?: number;
  maxSteps: number;
  clockSpeed: number;
  planningLeadSec: number;
  failures: Set<FailureName>;
  runId: string;
  runDir: string;
  tracePath: string;
  summaryPath: string;
  reportPath: string;
  configPath: string;
  manifestPath: string;
  mcpUrl: string;
  cookie?: string;
  outgoingTrackId?: number;
  prompt: string;
  scenario: BenchScenario;
  quiet: boolean;
  opencodeApiKey?: string;
  opencodeBaseUrl: string;
}

function readValue(argv: string[], name: string): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readPositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readOptionalPositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  return readPositiveInt(value, 1, name);
}

function readPositiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function parseFailures(value: string | undefined): Set<FailureName> {
  if (!value || value === "none") return new Set();
  const failures = value.split(",").filter(Boolean);
  const unknown = failures.filter(
    (failure): failure is string => !FAILURE_NAMES.includes(failure as FailureName),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown failure(s): ${unknown.join(", ")}. Expected ${FAILURE_NAMES.join(", ")}`);
  }
  return new Set(failures as FailureName[]);
}

function defaultRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${process.pid}`;
}

function artifactPaths(argv: string[]) {
  const explicitTrace = readValue(argv, "--trace");
  if (explicitTrace) {
    const tracePath = resolve(explicitTrace);
    const extension = extname(tracePath);
    const stem = basename(tracePath, extension);
    const runDir = dirname(tracePath);
    return {
      runId: stem,
      runDir,
      tracePath,
      summaryPath: join(runDir, `${stem}.summary.json`),
      reportPath: join(runDir, `${stem}.report.md`),
      configPath: join(runDir, `${stem}.config.json`),
      manifestPath: join(runDir, `${stem}.manifest.json`),
    };
  }
  const runId = defaultRunId();
  const runDir = resolve(process.cwd(), "logs", "dj-bench", runId);
  return {
    runId,
    runDir,
    tracePath: join(runDir, "trace.jsonl"),
    summaryPath: join(runDir, "summary.json"),
    reportPath: join(runDir, "report.md"),
    configPath: join(runDir, "config.json"),
    manifestPath: join(runDir, "manifest.json"),
  };
}

export function parseBenchConfig(
  argv = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): BenchConfig {
  const scenarioValue = readValue(argv, "--scenario") ?? "revibe";
  if (scenarioValue !== "revibe" && scenarioValue !== "interventions") {
    throw new Error("--scenario must be revibe or interventions");
  }
  const providerValue =
    readValue(argv, "--provider") ??
    env.DJ_BENCH_PROVIDER ??
    (env.OPENCODE_API_KEY ? "opencode" : "gateway");
  if (providerValue !== "gateway" && providerValue !== "opencode") {
    throw new Error("--provider must be gateway or opencode");
  }
  const opencodeApiKey = env.OPENCODE_API_KEY;
  if (providerValue === "opencode" && !opencodeApiKey) {
    throw new Error("OPENCODE_API_KEY is required with --provider opencode");
  }

  const outgoingValue = readValue(argv, "--outgoing-id");
  const artifacts = artifactPaths(argv);
  return {
    provider: providerValue,
    model:
      readValue(argv, "--model") ??
      env.DJ_MODEL ??
      (providerValue === "opencode" ? "deepseek-v4-flash" : "deepseek/deepseek-v4-flash"),
    targetDurationSec: readPositiveNumber(readValue(argv, "--duration-min"), 90, "--duration-min") * 60,
    transitions: readPositiveInt(
      readValue(argv, "--max-transitions") ?? readValue(argv, "--transitions"),
      64,
      "--max-transitions",
    ),
    timeoutMs: readOptionalPositiveInt(
      readValue(argv, "--timeout-ms") ?? env.DJ_EVAL_TIMEOUT_MS,
      "--timeout-ms",
    ),
    maxSteps: readPositiveInt(readValue(argv, "--max-steps"), 8, "--max-steps"),
    clockSpeed: readPositiveNumber(readValue(argv, "--clock-speed"), 1, "--clock-speed"),
    planningLeadSec: readPositiveNumber(
      readValue(argv, "--planning-lead-sec"),
      90,
      "--planning-lead-sec",
    ),
    failures: parseFailures(readValue(argv, "--fail")),
    ...artifacts,
    mcpUrl: readValue(argv, "--mcp-url") ?? env.DJ_BENCH_MCP_URL ?? "http://localhost:3000/api/mcp",
    cookie: readValue(argv, "--cookie") ?? env.DJ_BENCH_COOKIE,
    outgoingTrackId:
      outgoingValue === undefined
        ? undefined
        : readPositiveInt(outgoingValue, 0, "--outgoing-id"),
    prompt: readValue(argv, "--prompt") ?? DEFAULT_REVIBE_PROMPT,
    scenario: scenarioValue,
    quiet: argv.includes("--quiet"),
    opencodeApiKey,
    opencodeBaseUrl: env.OPENCODE_BASE_URL ?? "https://opencode.ai/zen/v1",
  };
}

export function benchHelp(): string {
  return `
Usage: bun run bench:dj [options]

Options:
  --provider <name>        gateway or opencode (auto: opencode when key exists)
  --model <id>             Gateway/provider model (default: DJ_MODEL)
  --duration-min <minutes> Audible set target (default: 90)
  --max-transitions <n>    Safety ceiling before target is reached (default: 64)
  --transitions <count>    Deprecated alias for --max-transitions
  --timeout-ms <ms>        Per-turn model timeout (default: 55000)
  --max-steps <count>      Tool-loop step ceiling (default: 8)
  --clock-speed <factor>   Convert wall latency into simulated playback time
  --planning-lead-sec <s>  Runway at start of each planning turn (default: 90)
  --fail <names>           Comma list: ${FAILURE_NAMES.join(", ")}
  --scenario <name>        revibe or interventions
  --mcp-url <url>          Real SoundCloud MCP endpoint
  --cookie <header>        Optional Cookie header for authenticated likes
  --outgoing-id <id>       Use this liked track as analyzed outgoing track
  --prompt <text>          Override initial user prompt
  --trace <path>           JSONL trace output; report files use same path stem
  --quiet                  Suppress terminal event timeline
  --help                   Show help

OpenCode Zen:
  OPENCODE_API_KEY=... bun run bench:dj --provider opencode --model gpt-5.6-terra
`.trim();
}
