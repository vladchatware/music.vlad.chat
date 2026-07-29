import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveBenchArtifact } from "./artifacts";

describe("bench artifacts", () => {
  it("resolves standard and flat artifacts inside bench root", () => {
    const root = mkdtempSync(join(tmpdir(), "dj-bench-artifacts-"));
    const directory = join(root, "run-1");
    mkdirSync(directory);
    writeFileSync(join(directory, "trace.jsonl"), "{}\n");
    writeFileSync(join(root, "custom.report.md"), "# Report\n");

    expect(resolveBenchArtifact(root, "run-1", "trace"))
      .toBe(join(directory, "trace.jsonl"));
    expect(resolveBenchArtifact(root, "custom", "report"))
      .toBe(join(root, "custom.report.md"));
  });

  it("rejects traversal and missing artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "dj-bench-artifacts-"));
    expect(resolveBenchArtifact(root, "../outside", "trace")).toBeNull();
    expect(resolveBenchArtifact(root, "missing", "summary")).toBeNull();
  });
});
