import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const BENCH_ARTIFACTS = {
  report: {
    directoryName: "report.md",
    flatSuffix: ".report.md",
    contentType: "text/markdown; charset=utf-8",
  },
  trace: {
    directoryName: "trace.jsonl",
    flatSuffix: ".jsonl",
    contentType: "application/x-ndjson; charset=utf-8",
  },
  summary: {
    directoryName: "summary.json",
    flatSuffix: ".summary.json",
    contentType: "application/json; charset=utf-8",
  },
  config: {
    directoryName: "config.json",
    flatSuffix: ".config.json",
    contentType: "application/json; charset=utf-8",
  },
} as const;

export type BenchArtifactName = keyof typeof BENCH_ARTIFACTS;

export function isInsideBenchRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

export function isBenchArtifactName(value: string): value is BenchArtifactName {
  return value in BENCH_ARTIFACTS;
}

export function resolveBenchArtifact(
  root: string,
  runId: string,
  artifact: BenchArtifactName,
): string | null {
  const definition = BENCH_ARTIFACTS[artifact];
  const candidates = [
    resolve(root, runId, definition.directoryName),
    resolve(root, `${runId}${definition.flatSuffix}`),
  ];
  return candidates.find(
    (candidate) => isInsideBenchRoot(root, candidate) && existsSync(candidate),
  ) ?? null;
}
