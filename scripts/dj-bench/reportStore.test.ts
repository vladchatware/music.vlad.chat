import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readBenchSummaries, readBenchTrace } from "./reportStore";

describe("bench report store", () => {
  it("skips malformed summaries without breaking valid history", () => {
    const root = mkdtempSync(join(tmpdir(), "dj-bench-store-"));
    const validDirectory = join(root, "valid");
    const malformedDirectory = join(root, "malformed");
    mkdirSync(validDirectory);
    mkdirSync(malformedDirectory);
    writeFileSync(join(validDirectory, "summary.json"), JSON.stringify({
      ok: true,
      validity: "valid",
      runId: "valid-run",
      startedAt: "2026-07-28T00:00:00.000Z",
      model: "test-model",
      provider: "test-provider",
      scenario: "revibe",
      requestedTransitions: 1,
      acceptedTransitions: 1,
      stateReads: 1,
      duplicateAcceptedTracks: 0,
      impossibleScheduleAttempts: 0,
      falseSuccessClaims: 0,
      reportPath: join(validDirectory, "report.md"),
      tokens: { total: 1 },
      continuity: { status: "pass" },
      coherenceEvidence: [],
    }));
    writeFileSync(join(malformedDirectory, "summary.json"), JSON.stringify({
      runId: "broken-run",
      startedAt: 42,
    }));

    expect(readBenchSummaries(root).map((summary) => summary.runId)).toEqual([
      "valid-run",
    ]);
  });

  it("expands relative artifact paths and reads bounded trace events", () => {
    const root = mkdtempSync(join(tmpdir(), "dj-bench-store-"));
    const directory = join(root, "run-1");
    mkdirSync(directory);
    writeFileSync(join(directory, "summary.json"), JSON.stringify({
      ok: true,
      validity: "valid",
      runId: "run-1",
      startedAt: "2026-07-28T00:00:00.000Z",
      model: "test-model",
      provider: "test-provider",
      scenario: "revibe",
      requestedTransitions: 1,
      acceptedTransitions: 1,
      stateReads: 1,
      duplicateAcceptedTracks: 0,
      impossibleScheduleAttempts: 0,
      falseSuccessClaims: 0,
      tracePath: "trace.jsonl",
      summaryPath: "summary.json",
      reportPath: "report.md",
      configPath: "config.json",
      tokens: { total: 1 },
      continuity: { status: "pass" },
      coherenceEvidence: [],
    }));
    writeFileSync(
      join(directory, "trace.jsonl"),
      '{"sequence":1,"type":"episode.started"}\nnot-json\n{"sequence":2,"type":"episode.finished"}\n',
    );

    const [stored] = readBenchSummaries(root);
    expect(stored?.reportPath).toBe(join(directory, "report.md"));
    expect(readBenchTrace(root, "run-1", 1)).toEqual([
      { sequence: 1, type: "episode.started" },
    ]);
  });
});
