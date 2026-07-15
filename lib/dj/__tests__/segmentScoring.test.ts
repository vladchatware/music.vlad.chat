import { describe, expect, it } from "vitest";

import { scoreSegmentPair } from "../segments/scoring";

const outgoing = {
  id: "out", startSec: 64, endSec: 96, section: "buildup" as const,
  energy: 0.62, energySlope: 0.012, rhythmicDensity: 0.7,
  exitQuality: 0.9, confidence: 0.85,
};

describe("scoreSegmentPair", () => {
  it("ranks a continuing rise above an energy reset", () => {
    const continuation = scoreSegmentPair(outgoing, {
      id: "continue", startSec: 32, endSec: 64, section: "drop",
      energy: 0.68, energySlope: 0.006, rhythmicDensity: 0.72,
      entryQuality: 0.85, confidence: 0.8,
    }, "build");
    const reset = scoreSegmentPair(outgoing, {
      id: "reset", startSec: 0, endSec: 32, section: "breakdown",
      energy: 0.2, energySlope: -0.01, rhythmicDensity: 0.2,
      entryQuality: 0.7, confidence: 0.8,
    }, "build");

    expect(continuation.overall).toBeGreaterThan(reset.overall);
    expect(continuation.energyContinuity).toBeGreaterThan(reset.energyContinuity);
  });

  it("penalizes vocal overlap only when both measurements exist", () => {
    const safe = scoreSegmentPair(
      { ...outgoing, vocalProbability: 0.9 },
      { ...outgoing, id: "safe", entryQuality: 0.8, vocalProbability: 0.1 },
      "preserve",
    );
    const overlap = scoreSegmentPair(
      { ...outgoing, vocalProbability: 0.9 },
      { ...outgoing, id: "overlap", entryQuality: 0.8, vocalProbability: 0.9 },
      "preserve",
    );
    const unknown = scoreSegmentPair(
      outgoing,
      { ...outgoing, id: "unknown", entryQuality: 0.8 },
      "preserve",
    );

    expect(safe.vocalSafety).toBeGreaterThan(overlap.vocalSafety);
    expect(unknown.vocalSafety).toBe(0.5);
  });

  it("uses MIREX mood continuity for preserve and contrast for reset", () => {
    const dark = { ...outgoing, mirexMood: { cheerful: 0.1, wistful: 0.9 } };
    const similar = { ...dark, id: "similar", entryQuality: 0.8 };
    const contrast = { ...dark, id: "contrast", entryQuality: 0.8, mirexMood: { cheerful: 0.9, wistful: 0.1 } };
    expect(scoreSegmentPair(dark, similar, "preserve").moodCompatibility)
      .toBeGreaterThan(scoreSegmentPair(dark, contrast, "preserve").moodCompatibility);
    expect(scoreSegmentPair(dark, contrast, "reset").moodCompatibility)
      .toBeGreaterThan(scoreSegmentPair(dark, similar, "reset").moodCompatibility);
  });
});
