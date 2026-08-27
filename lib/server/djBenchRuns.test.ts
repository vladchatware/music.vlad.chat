import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readBenchRun } from "./djBenchRuns";

describe("readBenchRun", () => {
  it("keeps run IDs inside the bench root", () => {
    const parent = mkdtempSync(join(tmpdir(), "dj-bench-runs-"));
    const root = join(parent, "runs");
    const run = join(root, "run-1");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "summary.json"), JSON.stringify({ runId: "run-1" }));
    writeFileSync(join(parent, "summary.json"), JSON.stringify({ runId: "escaped" }));

    expect(readBenchRun("run-1", root)?.summary).toMatchObject({ runId: "run-1" });
    expect(readBenchRun("..", root)).toBeNull();
    expect(readBenchRun(".", root)).toBeNull();
  });
});
