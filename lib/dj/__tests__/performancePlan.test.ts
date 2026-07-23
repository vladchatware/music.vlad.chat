import { describe, expect, it } from "vitest";

import {
  compilePerformancePlan,
  djPerformancePlanSchema,
  playerToolInputSchema,
  getCrossfaderGains,
  evaluatePerformanceLoop,
  type DeckSnapshot,
  type DJPerformancePlan,
} from "..";

function deck(id: "A" | "B", bpm: number, duration = 240): DeckSnapshot {
  const beatSec = 60 / bpm;
  return {
    id,
    track: { id: id === "A" ? 1 : 2, bpm, duration },
    positionSec: id === "A" ? 100 : 0,
    beatGrid: {
      bpm,
      beatsPerBar: 4,
      firstDownbeat: 0,
      beats: Array.from({ length: Math.floor(duration / beatSec) }, (_, index) => index * beatSec),
      confidence: 0.9,
    },
    structureMap: {
      duration,
      downbeats: [],
      phrases: [],
      sections: [
        { type: "intro", phrases: [], startTime: 0, endTime: 16, energy: 0.2 },
        { type: "breakdown", phrases: [], startTime: 96, endTime: 128, energy: 0.35 },
        { type: "drop", phrases: [], startTime: 128, endTime: 192, energy: 0.9 },
        { type: "outro", phrases: [], startTime: 192, endTime: duration, energy: 0.25 },
      ],
    },
    energyCurve: null,
    cuePoints: { mixInSec: 16, mixOutSec: 192, confidence: 0.9, reason: "fixture" },
  };
}

function performance(overrides: Partial<DJPerformancePlan> = {}): DJPerformancePlan {
  return {
    energyArc: "preserve",
    exit: { anchor: "mix_out" },
    entry: { anchor: "mix_in" },
    blend: {
      duration: { bars: 8 },
      crossfaderCurve: "equal_power",
      eq: "bass_swap",
      bassSwapAt: 0.5,
    },
    tempo: { mode: "match", maxAdjustmentPercent: 8 },
    reason: "Maintain phrase and energy continuity",
    ...overrides,
  };
}

describe("djPerformancePlanSchema", () => {
  it("accepts every declarative union member", () => {
    const exits: DJPerformancePlan["exit"][] = [
      { anchor: "next_phrase" },
      { anchor: "mix_out" },
      { anchor: "section", section: "drop" },
      { anchor: "time", timeSec: 120 },
    ];
    const entries: DJPerformancePlan["entry"][] = [
      { anchor: "mix_in" },
      { anchor: "first_downbeat" },
      { anchor: "section", section: "intro" },
      { anchor: "time", timeSec: 8 },
    ];
    for (const exit of exits) {
      expect(djPerformancePlanSchema.safeParse(performance({ exit })).success).toBe(true);
    }
    for (const entry of entries) {
      expect(djPerformancePlanSchema.safeParse(performance({ entry })).success).toBe(true);
    }
    for (const energyArc of ["preserve", "build", "release", "reset"] as const) {
      expect(djPerformancePlanSchema.safeParse(performance({ energyArc })).success).toBe(true);
    }
    for (const crossfaderCurve of ["equal_power", "linear", "cut"] as const) {
      for (const eq of ["bass_swap", "frequency_split", "smooth", "high_first"] as const) {
        expect(djPerformancePlanSchema.safeParse(performance({
          blend: { duration: { bars: 16 }, crossfaderCurve, eq },
        })).success).toBe(true);
      }
    }
    expect(djPerformancePlanSchema.safeParse(performance({
      loop: { deck: "incoming", bars: 8, repetitions: 4 },
    })).success).toBe(true);
  });

  it("accepts declarative plans and rejects raw playback controls", () => {
    expect(djPerformancePlanSchema.safeParse(performance()).success).toBe(true);
    expect(
      djPerformancePlanSchema.safeParse({
        ...performance(),
        playbackRate: 1.2,
      }).success,
    ).toBe(false);
  });

  it("requires fields needed by section and time anchors", () => {
    expect(
      djPerformancePlanSchema.safeParse({
        ...performance(),
        exit: { anchor: "section" },
      }).success,
    ).toBe(false);
    expect(
      djPerformancePlanSchema.safeParse({
        ...performance(),
        entry: { anchor: "time" },
      }).success,
    ).toBe(false);
    expect(
      djPerformancePlanSchema.safeParse({
        ...performance(),
        exit: { anchor: "mix_out", timeSec: 20 },
      }).success,
    ).toBe(false);
    expect(
      djPerformancePlanSchema.safeParse({
        ...performance(),
        tempo: { mode: "match", maxAdjustmentPercent: 9 },
      }).success,
    ).toBe(false);
  });
});

describe("playerToolInputSchema", () => {
  it("validates whole player boundary without casts", () => {
    expect(playerToolInputSchema.safeParse({ id: 42, performance: performance() }).success).toBe(true);
    expect(playerToolInputSchema.safeParse({ id: 0, performance: performance() }).success).toBe(false);
    expect(playerToolInputSchema.safeParse({ id: 42, performance: performance(), gain: 2 }).success).toBe(false);
  });
});

describe("compilePerformancePlan", () => {
  it("compiles analyzed anchors, bars, EQ, and crossfader intent", () => {
    const compiled = compilePerformancePlan(performance(), {
      outgoingDeck: deck("A", 120),
      incomingDeck: deck("B", 124),
      currentTimeSec: 100,
    });

    expect(compiled.plan.startBoundary.timeSec).toBe(192);
    expect(compiled.plan.crossfadeDurationSec).toBeCloseTo(16, 5);
    expect(compiled.performance.incomingStartSec).toBe(16);
    expect(compiled.performance.crossfaderCurve).toBe("equal_power");
    expect(compiled.performance.eqPreset).toBe("bassSwap");
    expect(compiled.performance.source).toBe("agent");
  });

  it("selects mix-in by outgoing-to-incoming segment compatibility", () => {
    const outgoing = {
      ...deck("A", 120),
      segments: [
        { id: "out", startSec: 160, endSec: 220, section: "buildup" as const, energy: 0.68, energySlope: 0.01, rhythmicDensity: 0.7, exitQuality: 0.9, confidence: 0.8 },
      ],
    };
    const incoming = {
      ...deck("B", 120),
      segments: [
        { id: "quiet", startSec: 16, endSec: 48, section: "breakdown" as const, energy: 0.2, energySlope: -0.01, rhythmicDensity: 0.2, entryQuality: 0.9, confidence: 0.8 },
        { id: "continue", startSec: 64, endSec: 96, section: "drop" as const, energy: 0.72, energySlope: 0.006, rhythmicDensity: 0.72, entryQuality: 0.75, confidence: 0.8 },
      ],
    };
    const compiled = compilePerformancePlan(performance(), {
      outgoingDeck: outgoing,
      incomingDeck: incoming,
      currentTimeSec: 100,
    });

    expect(compiled.performance.incomingStartSec).toBe(64);
    expect(compiled.diagnostics.accepted).toContain("segment_pair");
  });

  it("keeps enough of a short incoming track for the next DJ decision", () => {
    const compiled = compilePerformancePlan(
      performance({
        entry: { anchor: "time", timeSec: 40 },
      }),
      {
        outgoingDeck: deck("A", 108),
        incomingDeck: deck("B", 140, 100),
        currentTimeSec: 20,
      },
    );

    expect(
      100 -
        compiled.performance.incomingStartSec -
        compiled.plan.crossfadeDurationSec,
    ).toBeCloseTo(60, 5);
    expect(compiled.diagnostics.adjustments).toContain(
      "entry_clamped_for_continuity_runway",
    );
  });

  it("rejects incoming media that cannot cover the blend and next-decision runway", () => {
    expect(() =>
      compilePerformancePlan(
        performance({
          exit: { anchor: "time", timeSec: 80 },
          blend: {
            duration: { seconds: 60 },
            crossfaderCurve: "linear",
            eq: "smooth",
          },
        }),
        {
          outgoingDeck: deck("A", 120, 130),
          incomingDeck: deck("B", 120, 18),
          currentTimeSec: 110,
        },
      ),
    ).toThrow(/not selectable.*blend plus 60s continuity runway/i);
  });

  it("snaps explicit incoming time to a reliable bar boundary", () => {
    const compiled = compilePerformancePlan(
      performance({ entry: { anchor: "time", timeSec: 3.2 } }),
      {
        outgoingDeck: deck("A", 120),
        incomingDeck: deck("B", 120),
        currentTimeSec: 100,
      },
    );

    expect(compiled.performance.incomingStartSec).toBe(4);
    expect(compiled.diagnostics.adjustments).toContain("entry_snapped_to_bar");
    expect(compiled.diagnostics).toHaveProperty("fallbackReasons");
  });

  it("preserves tempo or clamps matching to agent and engine limits", () => {
    const preserved = compilePerformancePlan(
      performance({ tempo: { mode: "preserve" } }),
      { outgoingDeck: deck("A", 120), incomingDeck: deck("B", 110), currentTimeSec: 100 },
    );
    expect(preserved.plan.tempoAdjustment.targetPlaybackRate).toBe(1);
    expect(preserved.plan.tempoAdjustment.feasible).toBe(true);

    const limited = compilePerformancePlan(
      performance({ tempo: { mode: "match", maxAdjustmentPercent: 3 } }),
      { outgoingDeck: deck("A", 120), incomingDeck: deck("B", 110), currentTimeSec: 100 },
    );
    expect(limited.plan.tempoAdjustment.targetPlaybackRate).toBeCloseTo(1.03, 5);
    expect(limited.plan.tempoAdjustment.targetPlaybackRate).toBeLessThanOrEqual(1.08);
  });

  it("disables tempo matching when either beat grid is unreliable", () => {
    const incoming = {
      ...deck("B", 110),
      beatGrid: { ...deck("B", 110).beatGrid!, confidence: 0.1 },
    };
    const compiled = compilePerformancePlan(performance(), {
      outgoingDeck: deck("A", 120),
      incomingDeck: incoming,
      currentTimeSec: 100,
    });
    expect(compiled.plan.tempoAdjustment.targetPlaybackRate).toBe(1);
    expect(compiled.diagnostics.ignored).toContain("tempo_match_low_confidence");
  });

  it("pulls an unreachable exit earlier to keep the blend inside media bounds", () => {
    const compiled = compilePerformancePlan(performance(), {
      outgoingDeck: deck("A", 120, 130),
      incomingDeck: deck("B", 120, 180),
      currentTimeSec: 129.5,
    });
    expect(
      compiled.plan.startBoundary.timeSec + compiled.plan.crossfadeDurationSec,
    ).toBeLessThanOrEqual(130);
    expect(compiled.diagnostics.adjustments).toContain("exit_clamped_to_runway");
  });

  it("compiles phrase-sized loops and clamps bass swap position", () => {
    const compiled = compilePerformancePlan(
      performance({
        blend: {
          duration: { bars: 4 },
          crossfaderCurve: "cut",
          eq: "frequency_split",
          bassSwapAt: 0.95,
        },
        loop: { deck: "outgoing", bars: 4, repetitions: 2 },
      }),
      { outgoingDeck: deck("A", 120), incomingDeck: deck("B", 120), currentTimeSec: 100 },
    );

    expect(compiled.performance.bassSwapAt).toBe(0.8);
    expect(compiled.performance.loop).toMatchObject({
      deck: "outgoing",
      durationSec: 8,
      repetitions: 2,
    });
    expect(compiled.diagnostics.adjustments).toContain("bass_swap_clamped");
  });
});

describe("getCrossfaderGains", () => {
  it("supports linear, equal-power, and cut curves", () => {
    expect(getCrossfaderGains("linear", 0.25)).toEqual({ outgoing: 0.75, incoming: 0.25 });
    expect(getCrossfaderGains("equal_power", 0.5).incoming).toBeCloseTo(Math.SQRT1_2, 5);
    expect(getCrossfaderGains("equal_power", 0.5).outgoing).toBeCloseTo(Math.SQRT1_2, 5);
    expect(getCrossfaderGains("cut", 0.49)).toEqual({ outgoing: 1, incoming: 0 });
    expect(getCrossfaderGains("cut", 0.5)).toEqual({ outgoing: 0, incoming: 1 });
  });
});

describe("evaluatePerformanceLoop", () => {
  it("seeks on quantized boundaries until requested repetitions complete", () => {
    const loop = {
      deck: "outgoing" as const,
      startSec: 184,
      endSec: 192,
      durationSec: 8,
      repetitions: 2,
    };
    expect(evaluatePerformanceLoop(loop, 191.8, 0)).toEqual({
      shouldSeek: true,
      seekToSec: 184,
      completedRepetitions: 1,
      done: false,
    });
    expect(evaluatePerformanceLoop(loop, 191.8, 2)).toEqual({
      shouldSeek: false,
      seekToSec: null,
      completedRepetitions: 2,
      done: true,
    });
    expect(evaluatePerformanceLoop(loop, 180, 0).shouldSeek).toBe(false);
  });
});
