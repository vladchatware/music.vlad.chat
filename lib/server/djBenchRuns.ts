import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { BenchSummary } from "../../scripts/dj-bench/report";
import type { BenchTimelineManifest } from "../../scripts/dj-bench/timeline";

const RUN_ID = /^[A-Za-z0-9._-]+$/;

export interface BenchRunRecord {
  runId: string;
  summary: BenchSummary;
  hasTimeline: boolean;
}

export function benchRoot(): string {
  return resolve(process.cwd(), "logs", "dj-bench");
}

function parseJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function listBenchRuns(root = benchRoot()): BenchRunRecord[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
    .flatMap((entry) => {
      const summary = parseJson<BenchSummary>(join(root, entry.name, "summary.json"));
      if (!summary) return [];
      return [{
        runId: entry.name,
        summary,
        hasTimeline: existsSync(join(root, entry.name, "manifest.json")),
      }];
    })
    .sort((left, right) => right.summary.startedAt.localeCompare(left.summary.startedAt));
}

export function readBenchRun(
  runId: string,
  root = benchRoot(),
): { summary: BenchSummary; manifest: BenchTimelineManifest | null } | null {
  if (!RUN_ID.test(runId)) return null;
  const directory = resolve(root, runId);
  const relativeDirectory = relative(root, directory);
  if (
    relativeDirectory === "" ||
    relativeDirectory.startsWith("..") ||
    isAbsolute(relativeDirectory)
  ) return null;
  const summary = parseJson<BenchSummary>(join(directory, "summary.json"));
  if (!summary) return null;
  return {
    summary,
    manifest: parseJson<BenchTimelineManifest>(join(directory, "manifest.json")),
  };
}
