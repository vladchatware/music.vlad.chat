import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { BenchSummary } from "./report";

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
      return [JSON.parse(readFileSync(path, "utf8")) as BenchSummary];
    } catch {
      return [];
    }
  }).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
