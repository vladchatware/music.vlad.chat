import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseBenchConfig } from "./config";
import {
  coherenceGraph,
  continuityGraph,
  writeRunArtifacts,
  writeRunConfig,
  type BenchSummary,
} from "./report";

describe("DJ bench reports", () => {
  it("stores sanitized config, summary, and readable report", () => {
    const directory = mkdtempSync(join(tmpdir(), "dj-bench-report-"));
    const config = parseBenchConfig(
      ["--trace", join(directory, "run.jsonl")],
      { OPENCODE_API_KEY: "never-store-this" },
    );
    config.cookie = "also-never-store-this";
    writeRunConfig(config);

    const summary: BenchSummary = {
      ok: false,
      validity: "valid",
      invalidReason: null,
      runId: config.runId,
      startedAt: "2026-07-28T00:00:00.000Z",
      finishedAt: "2026-07-28T00:01:00.000Z",
      model: "deepseek-v4-flash",
      provider: "opencode",
      scenario: "revibe",
      prompt: "Play something coherent.",
      planningLeadSec: 90,
      requestedTransitions: 1,
      acceptedTransitions: 0,
      acceptedTrackIds: [],
      outgoingTrack: { id: 1, title: "Outgoing" },
      duplicateAcceptedTracks: 0,
      stateReads: 1,
      rejectedTransitions: 0,
      impossibleScheduleAttempts: 0,
      toolCalls: { dj_state: 1, track_analysis: 3 },
      toolFailures: {},
      scheduledTrackIds: [2, 3],
      analysisTrackIds: [2, 3],
      falseSuccessClaims: 0,
      backstageNarrationCount: 1,
      analysisBudgetRejections: 2,
      discoveryBudgetRejections: 1,
      tokens: { input: 100, output: 20, total: 120 },
      simulatedTimeSec: 48,
      tracePath: config.tracePath,
      summaryPath: config.summaryPath,
      reportPath: config.reportPath,
      configPath: config.configPath,
      error: "Turn 1 ended without accepted transition",
      continuity: {
        status: "fail",
        completedRatio: 0,
        noAcceptedTransition: true,
        impossibleScheduleAttempts: 0,
        steps: [],
      },
      coherenceEvidence: [],
      agentTranscript: [{
        turn: 1,
        step: 0,
        text: "Checking decks.",
        backstageNarration: true,
      }],
      claim: "Mechanical bench result only.",
    };
    writeRunArtifacts(config, summary);

    const storedConfig = readFileSync(config.configPath, "utf8");
    expect(storedConfig).not.toContain("never-store-this");
    expect(storedConfig).toContain('"hasCookie": true');
    expect(readFileSync(config.summaryPath, "utf8")).toContain('"continuity"');
    expect(readFileSync(config.reportPath, "utf8")).toContain(
      "**FAIL** — continuity fail.",
    );
    expect(readFileSync(config.reportPath, "utf8")).toContain(
      "COHERENCE UNSCORABLE",
    );
    expect(readFileSync(config.reportPath, "utf8")).toContain(
      "CONTINUITY FAIL",
    );
    expect(readFileSync(config.reportPath, "utf8")).toContain(
      "Checking decks.",
    );
    expect(readFileSync(config.reportPath, "utf8")).toContain(
      "BACKSTAGE LEAK",
    );
  });

  it("graphs accepted continuity and measured coherence", () => {
    const summary = {
      outgoingTrack: { id: 10 },
      requestedTransitions: 1,
      acceptedTransitions: 1,
      rejectedTransitions: 0,
      error: null,
      continuity: {
        status: "pass",
        steps: [{
          fromTrackId: 10,
          toTrackId: 11,
          acceptedAtSec: 80,
          scheduledAtSec: 96,
          blendDurationSec: 8,
        }],
      },
      coherenceEvidence: [{
        fromTrackId: 10,
        toTrackId: 11,
        tempo: {
          outgoingBpm: 122,
          incomingBpm: 124,
          normalizedDeltaPercent: 1.61,
        },
        harmonic: {
          outgoingKey: "4A",
          incomingKey: "4A",
          sameKey: true,
        },
        energy: {
          outgoingMean: 0.65,
          incomingMean: 0.72,
          delta: 0.07,
        },
        analysisComplete: true,
      }],
      agentTranscript: [],
    } as BenchSummary;

    expect(continuityGraph(summary)).toContain(
      'T0 -->|"T1 accepted<br/>cue 96.0s<br/>blend 8.0s"| T1["11"]',
    );
    expect(coherenceGraph(summary)).toContain(
      'tempo Δ 1.6%<br/>4A → 4A<br/>energy Δ +0.07',
    );
  });
});
