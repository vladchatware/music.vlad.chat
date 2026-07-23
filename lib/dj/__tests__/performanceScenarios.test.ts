import { describe, expect, it } from "vitest";

import {
  compilePerformancePlan,
  type DeckSnapshot,
  type DJPerformancePlan,
} from "..";

function deck(id: "A" | "B", bpm = 120, duration = 240, confidence = 0.9): DeckSnapshot {
  return {
    id,
    track: { id: id === "A" ? 1 : 2, bpm, duration },
    positionSec: id === "A" ? 100 : 0,
    beatGrid: { bpm, beatsPerBar: 4, firstDownbeat: 0, confidence },
    structureMap: {
      duration,
      phrases: [],
      downbeats: [],
      sections: [
        { type: "intro", phrases: [], startTime: 0, endTime: 16, energy: 0.2 },
        { type: "breakdown", phrases: [], startTime: 112, endTime: 128, energy: 0.3 },
        { type: "drop", phrases: [], startTime: 128, endTime: 192, energy: 0.9 },
        { type: "outro", phrases: [], startTime: 192, endTime: duration, energy: 0.2 },
      ],
    },
    energyCurve: null,
    cuePoints: { mixInSec: 16, mixOutSec: 192, confidence, reason: "fixture" },
  };
}

function intent(overrides: Partial<DJPerformancePlan> = {}): DJPerformancePlan {
  return {
    energyArc: "preserve",
    exit: { anchor: "next_phrase" },
    entry: { anchor: "mix_in" },
    blend: {
      duration: { bars: 8 },
      crossfaderCurve: "equal_power",
      eq: "smooth",
    },
    tempo: { mode: "match", maxAdjustmentPercent: 8 },
    reason: "scenario",
    ...overrides,
  };
}

function compile(
  performance: DJPerformancePlan,
  outgoing = deck("A"),
  incoming = deck("B"),
  currentTimeSec = 100,
) {
  return compilePerformancePlan(performance, { outgoingDeck: outgoing, incomingDeck: incoming, currentTimeSec });
}

describe("typed DJ performance scenarios", () => {
  it("phrase blend", () => {
    const result = compile(intent());
    expect(result.plan.startBoundary.isPhraseBoundary).toBe(true);
    expect(result.plan.crossfadeDurationSec).toBe(16);
  });

  it("drop swap", () => {
    const result = compile(intent({
      exit: { anchor: "section", section: "drop" },
      entry: { anchor: "section", section: "drop" },
      energyArc: "build",
    }));
    expect(result.plan.startBoundary.timeSec).toBe(128);
    expect(result.performance.incomingStartSec).toBe(128);
  });

  it("breakdown exit", () => {
    const result = compile(intent({ exit: { anchor: "section", section: "breakdown" } }));
    expect(result.plan.startBoundary.timeSec).toBe(112);
  });

  it("long blend", () => {
    expect(compile(intent({ blend: {
      duration: { seconds: 32 }, crossfaderCurve: "linear", eq: "frequency_split",
    } })).plan.crossfadeDurationSec).toBe(32);
  });

  it("quick cut", () => {
    const result = compile(intent({ blend: {
      duration: { seconds: 1 }, crossfaderCurve: "cut", eq: "high_first",
    } }));
    expect(result.performance.crossfaderCurve).toBe("cut");
    expect(result.plan.crossfadeDurationSec).toBe(1);
  });

  it("half-time matching", () => {
    const result = compile(intent(), deck("A", 174), deck("B", 87));
    expect(result.plan.tempoAdjustment.targetPlaybackRate).toBeCloseTo(1, 5);
    expect(result.plan.tempoAdjustment.feasible).toBe(true);
  });

  it("tempo preservation", () => {
    const result = compile(intent({ tempo: { mode: "preserve" } }), deck("A", 128), deck("B", 110));
    expect(result.plan.tempoAdjustment.targetPlaybackRate).toBe(1);
  });

  it("bass swap", () => {
    const result = compile(intent({ blend: {
      duration: { bars: 4 }, crossfaderCurve: "equal_power", eq: "bass_swap", bassSwapAt: 0.7,
    } }));
    expect(result.performance.eqPreset).toBe("bassSwap");
    expect(result.performance.bassSwapAt).toBe(0.7);
  });

  it("outgoing loop", () => {
    const result = compile(intent({ loop: { deck: "outgoing", bars: 4, repetitions: 3 } }));
    expect(result.performance.loop).toMatchObject({ deck: "outgoing", repetitions: 3 });
    expect(result.performance.loop?.startSec).toBeLessThan(result.performance.loop?.endSec ?? 0);
  });

  it("low-confidence analysis", () => {
    const result = compile(intent(), deck("A", 120, 240, 0.1), deck("B", 124, 240, 0.1));
    expect(result.plan.tempoAdjustment.targetPlaybackRate).toBe(1);
    expect(result.diagnostics.fallbackReasons).toContain("tempo_match_low_confidence");
  });

  it("short tracks", () => {
    expect(() =>
      compile(intent({ blend: {
        duration: { seconds: 32 }, crossfaderCurve: "linear", eq: "smooth",
      } }), deck("A", 120, 20), deck("B", 120, 18), 10),
    ).toThrow(/not selectable/i);
  });

  it("late agent decision", () => {
    const result = compile(intent({ exit: { anchor: "time", timeSec: 80 } }), deck("A"), deck("B"), 150);
    expect(result.plan.startBoundary.timeSec).toBeGreaterThanOrEqual(154);
    expect(result.diagnostics.adjustments).toContain("exit_moved_to_next_phrase");
  });

  it("gives deck preparation runway after agent decision", () => {
    expect(compile(intent(), deck("A"), deck("B"), 100).plan.startBoundary.timeSec)
      .toBeGreaterThanOrEqual(104);
  });

  it("moves non-reset section entry away from file start", () => {
    const result = compile(intent({ entry: { anchor: "section", section: "intro" } }));
    expect(result.performance.incomingStartSec).toBe(16);
    expect(result.diagnostics.adjustments).toContain("entry_moved_from_file_start_to_mix_in");
  });

  it("allows deliberate reset at file start", () => {
    const result = compile(intent({ energyArc: "reset", entry: { anchor: "first_downbeat" } }));
    expect(result.performance.incomingStartSec).toBe(0);
  });
});
