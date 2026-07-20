import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANALYSIS_SNAPSHOT,
  createTransitionPlan,
  djReducer,
  type DeckAnalysisMetadata,
  type DeckSnapshot,
  type DJState,
  type EnergyCurve,
} from "..";

function energy(values: number[]): EnergyCurve {
  return {
    samples: Float32Array.from(values),
    sampleRate: 1,
    peaks: [],
    valleys: [],
    duration: values.length,
  };
}

function deck(id: "A" | "B", trackId: number): DeckSnapshot {
  return {
    id,
    track: { id: trackId, duration: 180, bpm: 120 },
    positionSec: 30,
    beatGrid: { bpm: 120, beatsPerBar: 4, firstDownbeat: 0, confidence: 0.5 },
    structureMap: null,
    energyCurve: null,
  };
}

describe("persisted track analysis integration", () => {
  it("hydrates matching deck without reloading audio", () => {
    const state: DJState = {
      type: "cueing",
      activeDeck: deck("A", 1),
      cueDeck: deck("B", 2),
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };
    const metadata: DeckAnalysisMetadata = {
      bpm: 128,
      beatGrid: { bpm: 128, beatsPerBar: 4, firstDownbeat: 0.12, confidence: 0.9 },
      structureMap: { phrases: [], sections: [], downbeats: [0.12], duration: 180 },
      energyCurve: energy([0.2, 0.8]),
      cuePoints: { mixInSec: 16, mixOutSec: 144, confidence: 0.8, reason: "fixture" },
      keySignature: "Am",
      camelotKey: "8A",
    };

    const next = djReducer(state, {
      type: "TRACK_ANALYSIS_READY",
      trackId: 2,
      analysis: metadata,
    });
    expect(next.type).toBe("cueing");
    if (next.type !== "cueing") return;
    expect(next.activeDeck.track.bpm).toBe(120);
    expect(next.cueDeck.track.bpm).toBe(128);
    expect(next.cueDeck.track.camelotKey).toBe("8A");
    expect(next.cueDeck.cuePoints?.mixInSec).toBe(16);
  });

  it("ignores an analysis version already applied to the deck", () => {
    const state: DJState = {
      type: "playing",
      activeDeck: { ...deck("A", 1), analysisVersion: "v1" },
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };
    const next = djReducer(state, {
      type: "TRACK_ANALYSIS_READY",
      trackId: 1,
      analysis: { analysisVersion: "v1", energyCurve: energy([0.4]) },
    });
    expect(next).toBe(state);
  });

  it("returns planned transition to cueing so late metadata triggers replan", () => {
    const initial: DJState = {
      type: "planned",
      activeDeck: deck("A", 1),
      cueDeck: deck("B", 2),
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
      plan: createTransitionPlan({
        outgoingDeck: deck("A", 1),
        incomingDeck: deck("B", 2),
        currentTimeSec: 30,
        analysis: DEFAULT_ANALYSIS_SNAPSHOT,
      }),
    };
    const next = djReducer(initial, {
      type: "TRACK_ANALYSIS_READY",
      trackId: 2,
      analysis: {
        bpm: 124,
        energyCurve: energy([0.3, 0.7]),
      },
    });
    expect(next.type).toBe("cueing");
  });

  it("plans near analyzed mix-out and scores analyzed mix-in energy", () => {
    const outgoing = {
      ...deck("A", 1),
      cuePoints: { mixInSec: 0, mixOutSec: 120, confidence: 0.8, reason: "fixture" },
      energyCurve: energy(Array.from({ length: 180 }, (_, index) => (index === 120 ? 1 : 0))),
    };
    const incomingValues = Array.from({ length: 180 }, (_, index) => (index === 30 ? 1 : 0));
    const incoming = {
      ...deck("B", 2),
      cuePoints: { mixInSec: 30, mixOutSec: 150, confidence: 0.8, reason: "fixture" },
      energyCurve: energy(incomingValues),
    };
    const plan = createTransitionPlan({
      outgoingDeck: outgoing,
      incomingDeck: incoming,
      currentTimeSec: 30,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    });

    expect(plan.startBoundary.timeSec).toBeGreaterThanOrEqual(120);
    expect(plan.startBoundary.timeSec).toBeLessThanOrEqual(128);
    expect(plan.energyScore.energyMatch).toBeGreaterThan(0.9);
  });
});
