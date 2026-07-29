import { describe, expect, it } from "vitest";

import type { BenchSummary } from "./report";
import { renderBenchRunDetail } from "./runDetail";

function summary(): BenchSummary {
  return {
    ok: true,
    validity: "valid",
    invalidReason: null,
    runId: "run-1",
    startedAt: "2026-07-28T00:00:00.000Z",
    finishedAt: "2026-07-28T00:02:00.000Z",
    model: "deepseek-v4-flash",
    provider: "opencode",
    scenario: "revibe",
    prompt: 'Play <script>alert("x")</script>.',
    planningLeadSec: 90,
    requestedTransitions: 2,
    acceptedTransitions: 2,
    acceptedTrackIds: [2, 3],
    outgoingTrack: { id: 1, artist: "Artist", title: "Opener", bpm: 120 },
    duplicateAcceptedTracks: 0,
    stateReads: 4,
    rejectedTransitions: 1,
    impossibleScheduleAttempts: 0,
    toolCalls: { dj_state: 4, perform_transition: 3 },
    toolFailures: { "perform_transition.rejected": 1 },
    scheduledTrackIds: [],
    analysisTrackIds: [2],
    falseSuccessClaims: 0,
    backstageNarrationCount: 0,
    analysisBudgetRejections: 0,
    discoveryBudgetRejections: 0,
    tokens: { input: 1000, output: 200, total: 1200 },
    simulatedTimeSec: 180,
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
      steps: [
        {
          fromTrackId: 1,
          toTrackId: 2,
          acceptedAtSec: 40,
          scheduledAtSec: 80,
          blendDurationSec: 16,
        },
        {
          fromTrackId: 2,
          toTrackId: 3,
          acceptedAtSec: 120,
          scheduledAtSec: 64,
          blendDurationSec: 24,
        },
      ],
    },
    coherenceEvidence: [
      {
        fromTrackId: 1,
        toTrackId: 2,
        tempo: {
          outgoingBpm: 120,
          incomingBpm: 122,
          normalizedDeltaPercent: 1.6,
        },
        harmonic: { outgoingKey: "4A", incomingKey: "4A", sameKey: true },
        energy: { outgoingMean: 0.5, incomingMean: 0.6, delta: 0.1 },
        analysisComplete: true,
      },
      { fromTrackId: 2, toTrackId: 3, analysisComplete: false },
    ],
    agentTranscript: [],
    claim: "Mechanical only.",
  };
}

describe("bench run detail", () => {
  it("renders coherent run UI with partial evidence and artifact downloads", () => {
    const html = renderBenchRunDetail(summary(), [{
      sequence: 1,
      wallElapsedMs: 1500,
      simulatedTimeSec: 40,
      type: "transition.accepted",
      trackId: 2,
    }]);

    expect(html).toContain("Episode flight recorder");
    expect(html).toContain("T1");
    expect(html).toContain("T2");
    expect(html).toContain("evidence complete");
    expect(html).toContain("evidence partial");
    expect(html).toContain("1/2 transitions lack paired analysis");
    expect(html).toContain("/bench/runs/run-1/artifacts/trace");
    expect(html).toContain("transition.accepted");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("/tmp/trace.jsonl");
  });
});
