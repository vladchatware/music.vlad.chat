import { describe, expect, it } from "vitest";

import {
  MockDJRuntime,
  extractCandidateTracks,
  extractTrackAnalyses,
  type PerformTransitionInput,
} from "./runtime";

const candidateText =
  "201 Glass Current - Aqua Memory (125 BPM, ambient house, 204s)\n" +
  "202 Blue System - Soft Terminal (123 BPM, deep house, 210s)";

function transition(id: number, revision: number): PerformTransitionInput {
  return {
    id,
    expectedStateRevision: revision,
    performance: {
      energyArc: "preserve" as const,
      exit: { anchor: "mix_out" as const },
      entry: { anchor: "mix_in" as const },
      blend: {
        duration: { bars: 4 as const },
        crossfaderCurve: "equal_power" as const,
        eq: "smooth" as const,
      },
      tempo: { mode: "match" as const, maxAdjustmentPercent: 8 },
      reason: "Carry water-like texture into a steadier compatible pulse.",
    },
  };
}

describe("MockDJRuntime", () => {
  it("extracts MCP text candidates", () => {
    expect(extractCandidateTracks({ content: [{ type: "text", text: candidateText }] }))
      .toEqual([
        expect.objectContaining({ id: 201, bpm: 125, durationSec: 204 }),
        expect.objectContaining({ id: 202, bpm: 123, durationSec: 210 }),
      ]);
  });

  it("extracts embedded MCP analysis and starts from a real analyzed track", () => {
    const analysis = {
      trackId: "301",
      durationSec: 180,
      tempo: { bpm: 110 },
      tonal: { camelotKey: "8B" },
    };
    const output = {
      content: [{
        type: "text",
        text: JSON.stringify({ status: "ready", analysis }),
      }],
    };
    expect(extractTrackAnalyses(output)).toEqual([
      { trackId: 301, analysis },
    ]);

    const runtime = new MockDJRuntime([], 1, {
      track: { id: 301, title: "Real Opener", durationSec: 240 },
      analysis,
    });
    expect(runtime.snapshot()).toMatchObject({
      activeTrack: { id: 301, title: "Real Opener", bpm: 110, durationSec: 180 },
      activeTrackAnalysis: {
        trackId: "301",
        durationSec: 180,
        tempo: { bpm: 110 },
        tonal: { camelotKey: "8B" },
      },
      currentTimeSec: 90,
      playedTrackIds: [301],
    });
  });

  it("keeps full analysis internal and exposes compact DJ state evidence", () => {
    const runtime = new MockDJRuntime([], 1, {
      track: { id: 301, title: "Analyzed", durationSec: 180 },
      analysis: {
        trackId: "301",
        durationSec: 180,
        tempo: { bpm: 110, beatCount: 330 },
        energy: { mean: 0.6, trajectory: Array.from({ length: 100 }, () => 0.6) },
        exitSegments: [{
          id: "s1",
          startSec: 120,
          endSec: 140,
          section: "outro",
          energy: 0.4,
          genres: { ambient: 0.8 },
          hugeEmbedding: Array.from({ length: 100 }, () => 1),
        }],
      },
    });
    const state = runtime.snapshot();
    expect(state.activeTrackAnalysis).toMatchObject({
      tempo: { bpm: 110 },
      energy: { mean: 0.6 },
      nearbyExitSegments: [{
        id: "s1",
        section: "outro",
        genres: { ambient: 0.8 },
      }],
    });
    expect(JSON.stringify(state.activeTrackAnalysis)).not.toContain("trajectory");
    expect(JSON.stringify(state.activeTrackAnalysis)).not.toContain("hugeEmbedding");
  });

  it("uses fetched candidate analysis for tempo validation", () => {
    const runtime = new MockDJRuntime([], 1, {
      track: { id: 301, title: "Real Opener", bpm: 110, durationSec: 180 },
      analysis: { trackId: "301", durationSec: 180, tempo: { bpm: 110 } },
    });
    runtime.registerCandidates([{ id: 302, title: "Unknown Tempo", duration: 200_000 }]);
    runtime.registerTrackAnalyses({
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "ready",
          analysis: { trackId: "302", durationSec: 200, tempo: { bpm: 150 } },
        }),
      }],
    });
    runtime.beginTurn();
    const revision = runtime.readState().stateRevision;
    expect(runtime.performTransition(transition(302, revision)))
      .toMatchObject({ status: "rejected", reason: "unsafe_tempo_adjustment" });
  });

  it("accepts one discovered unplayed transition per turn", () => {
    const runtime = new MockDJRuntime();
    runtime.registerCandidates(candidateText);
    runtime.beginTurn();
    const revision = runtime.readState().stateRevision;

    expect(runtime.performTransition(transition(201, revision)).status).toBe("accepted");
    expect(runtime.performTransition(transition(202, runtime.snapshot().stateRevision)))
      .toMatchObject({ status: "rejected", reason: "action_already_accepted" });
    expect(runtime.stats.acceptedTransitions).toBe(1);
  });

  it("treats section notBeforeSec as a lower bound, not a literal past cue", () => {
    const runtime = new MockDJRuntime();
    runtime.registerCandidates(candidateText);
    runtime.beginTurn();
    const revision = runtime.readState().stateRevision;
    const input = transition(201, revision);
    input.performance.exit = {
      anchor: "section",
      section: "outro",
      notBeforeSec: 0,
    };
    expect(runtime.performTransition(input)).toMatchObject({ status: "accepted" });
  });

  it("rejects undiscovered and repeated tracks", () => {
    const runtime = new MockDJRuntime();
    runtime.registerCandidates(candidateText);
    runtime.beginTurn();
    let revision = runtime.readState().stateRevision;
    expect(runtime.performTransition(transition(999, revision)))
      .toMatchObject({ status: "rejected", reason: "undiscovered_track" });
    expect(runtime.performTransition(transition(201, revision)).status).toBe("accepted");
    runtime.advanceToNextPlanningWindow();
    runtime.beginTurn();
    revision = runtime.readState().stateRevision;
    expect(runtime.performTransition(transition(201, revision)))
      .toMatchObject({ status: "rejected", reason: "duplicate_track" });
  });

  it("injects stale state and unavailable-track failures once", () => {
    const runtime = new MockDJRuntime(["stale-state", "unavailable-track"]);
    runtime.registerCandidates(candidateText);
    runtime.beginTurn();
    const initial = runtime.readState();

    expect(runtime.performTransition(transition(201, initial.stateRevision)))
      .toMatchObject({ status: "rejected", reason: "stale_state" });
    const refreshed = runtime.readState();
    expect(runtime.performTransition(transition(201, refreshed.stateRevision)))
      .toMatchObject({ status: "rejected", reason: "track_unavailable" });
    expect(runtime.performTransition(transition(202, refreshed.stateRevision)).status).toBe("accepted");
  });

  it("rejects exits in past and unsafe tempo matches", () => {
    const runtime = new MockDJRuntime();
    runtime.registerCandidates([
      { id: 201, title: "Fast", bpm: 150, duration: 204_000 },
    ]);
    runtime.beginTurn();
    const revision = runtime.readState().stateRevision;
    const past = transition(201, revision);
    past.performance.exit = { anchor: "time", timeSec: 100 };
    expect(runtime.performTransition(past))
      .toMatchObject({ status: "rejected", reason: "exit_in_past" });

    const unsafe = transition(201, revision);
    expect(runtime.performTransition(unsafe))
      .toMatchObject({ status: "rejected", reason: "unsafe_tempo_adjustment" });
  });

  it("recovers from injected late decision with emergency cut", () => {
    const runtime = new MockDJRuntime(["late-decision"]);
    runtime.registerCandidates(candidateText);
    runtime.beginTurn();
    let revision = runtime.readState().stateRevision;

    expect(runtime.performTransition(transition(201, revision)))
      .toMatchObject({ status: "rejected", reason: "late_decision" });
    revision = runtime.readState().stateRevision;
    const emergency = transition(201, revision);
    emergency.performance.blend = {
      duration: { seconds: 1 },
      crossfaderCurve: "cut",
      eq: "high_first",
    };
    emergency.performance.tempo = { mode: "preserve" };
    expect(runtime.performTransition(emergency).status).toBe("accepted");
  });
});
