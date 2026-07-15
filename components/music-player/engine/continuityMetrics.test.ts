import { describe, expect, it } from "vitest";

import {
  computePhraseQuantizedHoldLoop,
  DEFAULT_ABRUPT_MISMATCH_THRESHOLD,
  computeCrossfadeProgressByClock,
  computeHandoffEnergyMismatch,
  evaluatePlannedTimeout,
  shouldEvaluatePlannedTimeout,
  isAbruptTransition,
  shouldTriggerAutoCue,
} from "./continuityMetrics";

describe("continuityMetrics", () => {
  it("computes monotonic crossfade progress by wall clock", () => {
    expect(
      computeCrossfadeProgressByClock({
        startedAtMs: 1_000,
        nowMs: 2_000,
        durationSec: 4,
      }),
    ).toBeCloseTo(0.25);

    expect(
      computeCrossfadeProgressByClock({
        startedAtMs: 1_000,
        nowMs: 6_000,
        durationSec: 4,
      }),
    ).toBe(1);
  });

  it("gates auto cue with 90s + 70% style thresholds", () => {
    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 95,
        progress01: 0.72,
        alreadyTriggered: false,
        isPlayingState: true,
      }),
    ).toBe(true);

    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 89,
        progress01: 0.8,
        alreadyTriggered: false,
        isPlayingState: true,
      }),
    ).toBe(false);

    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 120,
        progress01: 0.8,
        alreadyTriggered: true,
        isPlayingState: true,
      }),
    ).toBe(false);

    // Preparation starts during high energy; transition timing remains planner-controlled.
    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 95,
        progress01: 0.72,
        alreadyTriggered: false,
        isPlayingState: true,
        section: "culmination",
        durationSec: 130, // 35 seconds remaining, above 8 threshold
      }),
    ).toBe(true);

    // Should allow cueing if high energy but very close to end
    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 125,
        progress01: 0.96,
        alreadyTriggered: false,
        isPlayingState: true,
        section: "culmination",
        durationSec: 130, // 5 seconds remaining, <= 8 threshold
      }),
    ).toBe(true);
  });

  it("falls back to near-end cueing for short tracks", () => {
    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 2,
        durationSec: 29.7,
        progress01: 0.06,
        alreadyTriggered: false,
        isPlayingState: true,
      }),
    ).toBe(false);

    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 5,
        durationSec: 29.7,
        progress01: 0.17,
        alreadyTriggered: false,
        isPlayingState: true,
      }),
    ).toBe(true);

    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 3,
        durationSec: 29.7,
        progress01: 0.1,
        alreadyTriggered: false,
        isPlayingState: true,
      }),
    ).toBe(false);
  });

  it("does not auto-cue immediately after a deep entry point", () => {
    expect(shouldTriggerAutoCue({
      currentTimeSec: 57, listenedSec: 1, durationSec: 106, progress01: 0.54,
      alreadyTriggered: false, isPlayingState: true,
    })).toBe(false);
    expect(shouldTriggerAutoCue({
      currentTimeSec: 87, listenedSec: 31, durationSec: 106, progress01: 0.82,
      alreadyTriggered: false, isPlayingState: true,
    })).toBe(true);
  });

  it("computes phrase-quantized hold loops when BPM is known", () => {
    const plan = computePhraseQuantizedHoldLoop({
      durationSec: 180,
      bpm: 120,
    });
    expect(plan.bpm).toBe(120);
    expect(plan.barDurationSec).toBeCloseTo(2);
    expect(plan.loopStartSec % 2).toBeCloseTo(0, 6);
    expect(plan.windowSec).toBeLessThanOrEqual(24);
    expect(plan.windowSec).toBeGreaterThanOrEqual(6);
  });

  it("falls back to deterministic window when BPM is unknown", () => {
    const plan = computePhraseQuantizedHoldLoop({
      durationSec: 29.7,
      bpm: null,
      fallbackWindowSec: 12,
    });
    expect(plan.bpm).toBeNull();
    expect(plan.barDurationSec).toBeNull();
    expect(plan.loopStartSec).toBeCloseTo(17.7);
    expect(plan.windowSec).toBeCloseTo(12);
  });

  it("scores handoff mismatch and abrupt classification", () => {
    const mismatch = computeHandoffEnergyMismatch({
      outgoingEnergy: 0.85,
      incomingEnergy: 0.3,
    });
    expect(mismatch).toBeCloseTo(0.55);
    expect(
      isAbruptTransition({
        mismatch,
        threshold: DEFAULT_ABRUPT_MISMATCH_THRESHOLD,
      }),
    ).toBe(true);

    const smooth = computeHandoffEnergyMismatch({
      outgoingEnergy: 0.5,
      incomingEnergy: 0.45,
    });
    expect(
      isAbruptTransition({
        mismatch: smooth,
      }),
    ).toBe(false);
  });

  it("evaluates planned timeout as none/replan/abort", () => {
    expect(
      evaluatePlannedTimeout({
        plannedAtMs: 1_000,
        nowMs: 10_000,
        replanCount: 0,
        timeoutMs: 12_000,
      }),
    ).toBe("none");

    expect(
      evaluatePlannedTimeout({
        plannedAtMs: 1_000,
        nowMs: 20_000,
        replanCount: 1,
        timeoutMs: 12_000,
        maxReplans: 2,
      }),
    ).toBe("replan");

    expect(
      evaluatePlannedTimeout({
        plannedAtMs: 1_000,
        nowMs: 20_000,
        replanCount: 2,
        timeoutMs: 12_000,
        maxReplans: 2,
      }),
    ).toBe("abort");
  });

  it("does not timeout a valid plan while waiting for a future boundary", () => {
    expect(
      shouldEvaluatePlannedTimeout({ currentTimeSec: 100, plannedStartSec: 192 }),
    ).toBe(false);
    expect(
      shouldEvaluatePlannedTimeout({ currentTimeSec: 192.5, plannedStartSec: 192 }),
    ).toBe(true);
  });
});
