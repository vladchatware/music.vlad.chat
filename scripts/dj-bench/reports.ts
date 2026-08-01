import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import type { BenchSummary } from "./report";
import { writeBenchmarkDashboard } from "./dashboard";

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function summaries(root: string): BenchSummary[] {
  if (!existsSync(root)) return [];
  const paths = readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return [join(root, entry.name, "summary.json")];
    if (entry.isFile() && entry.name.endsWith(".summary.json")) {
      return [join(root, entry.name)];
    }
    return [];
  });
  return paths.flatMap((path) => {
    try {
      return [JSON.parse(readFileSync(path, "utf8")) as BenchSummary];
    } catch {
      return [];
    }
  }).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

const argv = process.argv.slice(2);
const rootArgIndex = argv.indexOf("--root");
const root = resolve(
  rootArgIndex >= 0 && argv[rootArgIndex + 1]
    ? argv[rootArgIndex + 1]!
    : join(process.cwd(), "logs", "dj-bench"),
);
const limitIndex = argv.indexOf("--limit");
const limit = readPositiveInt(limitIndex >= 0 ? argv[limitIndex + 1] : undefined, 20);
const allRuns = summaries(root);
const runs = allRuns.slice(0, limit);
const dashboardPath = writeBenchmarkDashboard(root, allRuns);

if (argv.includes("--latest")) {
  const latest = runs[0];
  if (!latest) {
    process.stderr.write(`No DJ bench reports under ${root}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(readFileSync(latest.reportPath, "utf8"));
  }
} else if (argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
} else if (runs.length === 0) {
  process.stdout.write(`No DJ bench reports under ${root}\n`);
} else {
  process.stdout.write([
    "RESULT  CONTINUITY  COVERAGE     MODEL                 RUN",
    ...runs.map((run) => [
      run.validity === "invalid" ? "INVALID" : run.ok ? "PASS   " : "FAIL   ",
      run.continuity.status.toUpperCase().padEnd(10),
      `${((run.achievedDurationSec ?? run.simulatedTimeSec) / 60).toFixed(1)}m`.padEnd(11),
      run.model.slice(0, 20).padEnd(21),
      run.runId,
    ].join("  ")),
    "",
    `Latest report: ${runs[0]!.reportPath}`,
    `Benchmark dashboard: ${dashboardPath}`,
    "",
  ].join("\n"));
}
