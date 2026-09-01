import { describe, expect, it } from "vitest";

import { normalizeTransitionMechanics } from "./mechanics";

const request = {
  requestedExitSec: 100,
  requestedEntrySec: 16,
  requestedBlendDurationSec: 16,
  targetPlaybackRate: 1,
  maxAdjustmentPercent: 8,
  minimumExitSec: 75,
  outgoingDurationSec: 180,
  incomingDurationSec: 200,
  minimumIncomingRunwaySec: 95,
};

describe("normalizeTransitionMechanics", () => {
  it("clamps playback rate to the requested adjustment cap", () => {
    const normalized = normalizeTransitionMechanics({
      ...request,
      targetPlaybackRate: 1.08,
      maxAdjustmentPercent: 2,
    });

    expect(normalized.playbackRate).toBe(1.02);
    expect(normalized.adjustments).toContain("tempo_clamped");
  });

  it("moves entry earlier to preserve incoming audible runway", () => {
    const normalized = normalizeTransitionMechanics({
      ...request,
      requestedEntrySec: 40,
      incomingDurationSec: 120,
    });

    expect(normalized.entrySec).toBe(25);
    expect(normalized.adjustments).toContain("entry_clamped_for_continuity_runway");
  });

  it("moves exit earlier so the blend fits the outgoing track", () => {
    const normalized = normalizeTransitionMechanics({
      ...request,
      requestedExitSec: 130.05,
      outgoingDurationSec: 133,
    });

    expect(normalized.exitSec).toBe(117);
    expect(normalized.adjustments).toContain("exit_clamped_to_runway");
  });

  it("shortens oversized blends to the transition runway cap", () => {
    const normalized = normalizeTransitionMechanics({
      ...request,
      requestedBlendDurationSec: 80,
    });

    expect(normalized.blendDurationSec).toBe(32);
    expect(normalized.adjustments).toContain("blend_clamped_to_runway");
  });
});
