import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { BenchSummary } from "./report";

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
      return isBenchSummary(summary) ? [summary] : [];
    } catch {
      return [];
    }
  }).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
