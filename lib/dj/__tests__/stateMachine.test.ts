import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANALYSIS_SNAPSHOT,
  djReducer,
  getActiveDeck,
  getInitialDJState,
  isTrackPlaying,
  isTransitionActive,
  type DeckSnapshot,
  type DJState,
  type TransitionPlan,
} from "..";

const deck = (id: "A" | "B", trackId: number): DeckSnapshot => ({
  id,
  track: { id: trackId, bpm: 120, duration: 180 },
  positionSec: 0,
  beatGrid: null,
  structureMap: null,
  energyCurve: null,
});

const plan: TransitionPlan = {
  startBoundary: { timeSec: 120, barIndex: 60, isPhraseBoundary: true },
  crossfadeDurationSec: 16,
  tempoAdjustment: { targetPlaybackRate: 1, phaseOffsetMs: 0, confidence: 1, feasible: true },
  eqCurve: { durationSec: 16, outgoing: [], incoming: [] },
  harmonicScore: { compatibility: 1, relationship: "same", suggestedPitchShift: 0, recommended: true },
  energyScore: { energyMatch: 1, momentumMatch: 1, contrastScore: 0.5, overall: 1 },
  quality: 1,
  createdAt: 0,
};

function playing(activeDeck = deck("A", 1)): DJState {
  return { type: "playing", activeDeck, analysis: DEFAULT_ANALYSIS_SNAPSHOT };
}

describe("DJ state reducer", () => {
  it("runs initial load, ready, play, and pause lifecycle", () => {
    let state = djReducer(getInitialDJState(), {
      type: "LOAD_TRACK",
      trackId: 1,
      deck: "A",
    });
    expect(state).toEqual({ type: "loading", trackId: 1, deck: "A" });

    state = djReducer(state, { type: "TRACK_LOADED", deck: deck("A", 1) });
    expect(state.type).toBe("ready");

    state = djReducer(state, { type: "PLAY" });
    expect(state.type).toBe("playing");

    state = djReducer(state, { type: "PAUSE" });
    expect(state.type).toBe("paused");

    state = djReducer(state, { type: "PLAY" });
    expect(state.type).toBe("playing");
  });

  it("runs cue, plan, crossfade, and completion lifecycle", () => {
    let state = djReducer(playing(), { type: "CUE_READY", deck: deck("B", 2) });
    expect(state.type).toBe("cueing");

    state = djReducer(state, { type: "PLAN_TRANSITION", plan });
    expect(state.type).toBe("planned");

    state = djReducer(state, { type: "START_CROSSFADE" });
    expect(state.type).toBe("crossfading");

    state = djReducer(state, { type: "CROSSFADE_TICK", progress: 0.5 });
    expect(state.type === "crossfading" && state.progress).toBe(0.5);

    state = djReducer(state, { type: "CROSSFADE_COMPLETE" });
    expect(state.type).toBe("playing");
    expect(getActiveDeck(state)?.id).toBe("B");
  });

  it("keeps runtime-only commands state-neutral", () => {
    const state = playing();
    expect(djReducer(state, { type: "SEEK", positionSec: 30 })).toBe(state);
    expect(djReducer(state, { type: "CUE_TRACK", trackId: 2 })).toBe(state);
    expect(djReducer(state, { type: "CUE_FAILED", error: "network" })).toBe(state);
  });

  it("updates live analysis and returns planned state to cueing for metadata replan", () => {
    const updated = { ...DEFAULT_ANALYSIS_SNAPSHOT, overallEnergy: 0.8 };
    const analyzed = djReducer(playing(), { type: "ANALYSIS_UPDATE", analysis: updated });
    expect(analyzed.type === "playing" && analyzed.analysis.overallEnergy).toBe(0.8);

    const planned: DJState = {
      type: "planned",
      activeDeck: deck("A", 1),
      cueDeck: deck("B", 2),
      plan,
      analysis: updated,
    };
    const hydrated = djReducer(planned, {
      type: "TRACK_ANALYSIS_READY",
      trackId: 2,
      analysis: {
        bpm: 124,
        energyCurve: { samples: new Float32Array([0.2]), sampleRate: 1, peaks: [], valleys: [], duration: 1 },
      },
    });
    expect(hydrated.type).toBe("cueing");
    expect(hydrated.type === "cueing" && hydrated.cueDeck.track.bpm).toBe(124);
  });

  it("cancels pre-crossfade transition but ignores cancellation during crossfade", () => {
    const cueing: DJState = {
      type: "cueing",
      activeDeck: deck("A", 1),
      cueDeck: deck("B", 2),
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };
    expect(djReducer(cueing, { type: "CANCEL_TRANSITION" }).type).toBe("playing");

    const crossfading: DJState = {
      type: "crossfading",
      outgoingDeck: deck("A", 1),
      incomingDeck: deck("B", 2),
      plan,
      progress: 0.3,
    };
    expect(djReducer(crossfading, { type: "CANCEL_TRANSITION" })).toBe(crossfading);
  });

  it("resets every active phase to idle", () => {
    const states: DJState[] = [
      { type: "loading", trackId: 1, deck: "A" },
      { type: "ready", activeDeck: deck("A", 1) },
      playing(),
      { type: "paused", activeDeck: deck("A", 1) },
      {
        type: "cueing",
        activeDeck: deck("A", 1),
        cueDeck: deck("B", 2),
        analysis: DEFAULT_ANALYSIS_SNAPSHOT,
      },
      {
        type: "planned",
        activeDeck: deck("A", 1),
        cueDeck: deck("B", 2),
        plan,
        analysis: DEFAULT_ANALYSIS_SNAPSHOT,
      },
      {
        type: "crossfading",
        outgoingDeck: deck("A", 1),
        incomingDeck: deck("B", 2),
        plan,
        progress: 0,
      },
    ];
    for (const state of states) {
      expect(djReducer(state, { type: "RESET" })).toEqual({ type: "idle" });
    }
  });

  it("reports playback and transition predicates from state only", () => {
    expect(isTrackPlaying(playing())).toBe(true);
    expect(isTransitionActive(playing())).toBe(false);
    const cueing = djReducer(playing(), { type: "CUE_READY", deck: deck("B", 2) });
    expect(isTrackPlaying(cueing)).toBe(true);
    expect(isTransitionActive(cueing)).toBe(true);
    expect(isTrackPlaying(getInitialDJState())).toBe(false);
  });

  it("is deterministic and does not mutate input", () => {
    const state = playing();
    const event = { type: "ANALYSIS_UPDATE", analysis: DEFAULT_ANALYSIS_SNAPSHOT } as const;
    const before = structuredClone(state);
    expect(djReducer(state, event)).toEqual(djReducer(state, event));
    expect(state).toEqual(before);
  });
});
