import { describe, expect, it } from "vitest";

import {
  computePhraseQuantizedHoldLoop,
  DEFAULT_ABRUPT_MISMATCH_THRESHOLD,
  computeCrossfadeProgressByClock,
  computeHandoffEnergyMismatch,
  classifyExecutedEnergyArc,
  evaluatePlannedTimeout,
  getEndedNextTrackAction,
  shouldEvaluatePlannedTimeout,
  isAbruptTransition,
  shouldTriggerAutoCue,
  shouldTriggerAnalyzedAutoCue,
} from "./continuityMetrics";

describe("continuityMetrics", () => {
  it("does not disguise a finished failed attempt as pending continuity", () => {
    expect(getEndedNextTrackAction({ revibeTriggered: true, requestInFlight: false })).toBe(
      "failed_attempt",
    );
    expect(getEndedNextTrackAction({ revibeTriggered: true, requestInFlight: true })).toBe("hold_pending");
    expect(getEndedNextTrackAction({ revibeTriggered: false, requestInFlight: false })).toBe("request");
  });

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

  it("starts continuous-set planning after a four-second playback settle", () => {
    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 4,
        listenedSec: 4,
        progress01: 0.02,
        alreadyTriggered: false,
        isPlayingState: true,
      }),
    ).toBe(true);

    expect(
      shouldTriggerAutoCue({
        currentTimeSec: 3,
        listenedSec: 3,
        progress01: 0.02,
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

  it("opens planning early when a transition enters deep into a short track", () => {
    expect(shouldTriggerAutoCue({
      currentTimeSec: 48,
      listenedSec: 4,
      durationSec: 99,
      progress01: 48 / 99,
      alreadyTriggered: false,
      isPlayingState: true,
    })).toBe(true);
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

  it("opens analyzed planning window with full 75 second runway", () => {
    expect(shouldTriggerAnalyzedAutoCue({
      currentTimeSec: 124,
      mixOutSec: 200,
      listenedSec: 30,
      alreadyTriggered: false,
    })).toBe(false);
    expect(shouldTriggerAnalyzedAutoCue({
      currentTimeSec: 125,
      mixOutSec: 200,
      listenedSec: 30,
      alreadyTriggered: false,
    })).toBe(true);
    expect(shouldTriggerAnalyzedAutoCue({
      currentTimeSec: 150,
      mixOutSec: 200,
      listenedSec: 60,
      alreadyTriggered: true,
    })).toBe(false);
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

  it("classifies full handoff energy trajectory", () => {
    expect(
      classifyExecutedEnergyArc({
        outgoingEnergyAtStart: 0.2,
        incomingEnergyAtEnd: 0.7,
      }),
    ).toBe("build");
    expect(
      classifyExecutedEnergyArc({
        outgoingEnergyAtStart: 0.5,
        incomingEnergyAtEnd: 0.58,
      }),
    ).toBe("preserve");
    expect(
      classifyExecutedEnergyArc({
        outgoingEnergyAtStart: 0.8,
        incomingEnergyAtEnd: 0.45,
      }),
    ).toBe("release");
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
