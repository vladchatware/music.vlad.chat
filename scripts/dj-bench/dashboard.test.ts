import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderBenchmarkDashboard, writeBenchmarkDashboard } from "./dashboard";
import type { BenchSummary } from "./report";

function run(overrides: Partial<BenchSummary>): BenchSummary {
  return {
    ok: true,
    validity: "valid",
    invalidReason: null,
    runId: "run-1",
    startedAt: "2026-07-28T00:00:00.000Z",
    finishedAt: "2026-07-28T00:01:00.000Z",
    model: "deepseek-v4-flash",
    provider: "opencode",
    scenario: "revibe",
    prompt: "Play.",
    planningLeadSec: 90,
    requestedTransitions: 2,
    acceptedTransitions: 2,
    acceptedTrackIds: [2, 3],
    outgoingTrack: { id: 1 },
    duplicateAcceptedTracks: 0,
    stateReads: 2,
    rejectedTransitions: 0,
    impossibleScheduleAttempts: 0,
    toolCalls: { dj_state: 2 },
    toolFailures: {},
    scheduledTrackIds: [],
    analysisTrackIds: [2, 3],
    falseSuccessClaims: 0,
    backstageNarrationCount: 0,
    analysisBudgetRejections: 0,
    discoveryBudgetRejections: 0,
    tokens: { input: 100, output: 20, total: 120 },
    simulatedTimeSec: 100,
    tracePath: "/tmp/trace.jsonl",
    summaryPath: "/tmp/summary.json",
    reportPath: "/tmp/report.md",
    configPath: "/tmp/config.json",
    error: null,
    continuity: {
      status: "pass",
      completedRatio: 1,
      noAcceptedTransition: false,
      impossibleScheduleAttempts: 0,
      steps: [],
    },
    coherenceEvidence: [{
      fromTrackId: 1,
      toTrackId: 2,
      tempo: {
        outgoingBpm: 120,
        incomingBpm: 122,
        normalizedDeltaPercent: 1.64,
      },
      harmonic: { outgoingKey: "4A", incomingKey: "4A", sameKey: true },
      energy: { outgoingMean: 0.6, incomingMean: 0.7, delta: 0.1 },
      analysisComplete: true,
    }],
    agentTranscript: [],
    claim: "Mechanical only.",
    ...overrides,
  };
}

describe("benchmark dashboard", () => {
  it("aggregates performance runs and separates infrastructure failures", () => {
    const root = mkdtempSync(join(tmpdir(), "dj-bench-dashboard-"));
    const path = writeBenchmarkDashboard(root, [
      run({}),
      run({
        runId: "infra",
        ok: false,
        outgoingTrack: null,
        stateReads: 0,
        acceptedTransitions: 0,
        acceptedTrackIds: [],
        error: "MCP unavailable",
        continuity: {
          status: "fail",
          completedRatio: 0,
          noAcceptedTransition: true,
          impossibleScheduleAttempts: 0,
          steps: [],
        },
        coherenceEvidence: [],
      }),
    ]);
    const html = readFileSync(path, "utf8");
    expect(html).toContain("2 stored attempts · 1 performance episodes");
    expect(html).toContain("<b>100%</b>");
    expect(html).toContain("<b>1</b>");
    expect(html).toContain("Continuity survival");
    expect(html).toContain("Coherence trajectory");
    expect(html).toContain("Episode drill-down");
  });

  it("supports web report links without exposing local file paths", () => {
    const root = mkdtempSync(join(tmpdir(), "dj-bench-dashboard-"));
    const html = renderBenchmarkDashboard(
      root,
      [run({ reportPath: join(root, "run-1", "report.md") })],
      (summary) => `/bench/runs/${summary.runId}`,
    );

    expect(html).toContain('href="/bench/runs/run-1"');
    expect(html).not.toContain("file://");
  });

  it("escapes analyzed key labels before rendering them", () => {
    const html = renderBenchmarkDashboard("/tmp", [
      run({
        coherenceEvidence: [{
          fromTrackId: 1,
          toTrackId: 2,
          harmonic: {
            outgoingKey: '4A<script>alert("x")</script>',
            incomingKey: "5A</div>",
            sameKey: false,
          },
          analysisComplete: true,
        }],
      }),
    ]);

    expect(html).not.toContain("<script>");
    expect(html).toContain("4A&lt;script&gt;");
    expect(html).toContain("5A&lt;/div&gt;");
  });
});
