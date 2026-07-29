import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { BenchSummary } from "./report";
import { resolveBenchArtifact } from "./artifacts";

export type BenchTraceEvent = {
  sequence?: number;
  wallElapsedMs?: number;
  simulatedTimeSec?: number;
  type: string;
  tool?: string;
  trackId?: number | string;
  turn?: number;
  step?: number;
  [key: string]: unknown;
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBenchSummary(value: unknown): value is BenchSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<BenchSummary>;
  return (
    typeof summary.ok === "boolean" &&
    (summary.validity === "valid" || summary.validity === "invalid") &&
    typeof summary.runId === "string" &&
    typeof summary.startedAt === "string" &&
    !Number.isNaN(Date.parse(summary.startedAt)) &&
    typeof summary.model === "string" &&
    typeof summary.provider === "string" &&
    typeof summary.scenario === "string" &&
    isNumber(summary.requestedTransitions) &&
    isNumber(summary.acceptedTransitions) &&
    isNumber(summary.stateReads) &&
    isNumber(summary.duplicateAcceptedTracks) &&
    isNumber(summary.impossibleScheduleAttempts) &&
    isNumber(summary.falseSuccessClaims) &&
    typeof summary.reportPath === "string" &&
    Boolean(summary.tokens) &&
    isNumber(summary.tokens?.total) &&
    Boolean(summary.continuity) &&
    (summary.continuity?.status === "pass" || summary.continuity?.status === "fail") &&
    Array.isArray(summary.coherenceEvidence)
  );
}

export function readBenchSummaries(root: string): BenchSummary[] {
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
      const summary: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isBenchSummary(summary)) return [];
      const directory = dirname(path);
      const expand = (artifactPath: unknown, fallback: string) =>
        typeof artifactPath === "string"
          ? isAbsolute(artifactPath)
            ? artifactPath
            : resolve(directory, artifactPath)
          : resolve(directory, fallback);
      return [{
        ...summary,
        tracePath: expand(summary.tracePath, "trace.jsonl"),
        summaryPath: expand(summary.summaryPath, "summary.json"),
        reportPath: expand(summary.reportPath, "report.md"),
        configPath: expand(summary.configPath, "config.json"),
      }];
    } catch {
      return [];
    }
  }).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function readBenchTrace(
  root: string,
  runId: string,
  limit = 400,
): BenchTraceEvent[] {
  const tracePath = resolveBenchArtifact(root, runId, "trace");
  if (!tracePath) return [];
  try {
    return readFileSync(tracePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const event: unknown = JSON.parse(line);
          if (
            event &&
            typeof event === "object" &&
            typeof (event as { type?: unknown }).type === "string"
          ) {
            return [event as BenchTraceEvent];
          }
        } catch {
          return [];
        }
        return [];
      })
      .slice(0, limit);
  } catch {
    return [];
  }
}
