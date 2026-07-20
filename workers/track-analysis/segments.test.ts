import { describe, expect, it } from "vitest";

import { deriveAnalysisSegments } from "./segments";

const downbeats = Array.from({ length: 17 }, (_, index) => index * 8);
const beats = Array.from({ length: 65 }, (_, index) => index * 2);

describe("deriveAnalysisSegments", () => {
  it("detects multiple sustained energy states and snaps boundaries to downbeats", () => {
    const samples = [
      ...Array(32).fill(0.2),
      ...Array(64).fill(0.85),
      ...Array(32).fill(0.3),
    ];
    const segments = deriveAnalysisSegments({
      durationSec: 128,
      energySamples: samples,
      energySampleRate: 1,
      beatsSec: beats,
      downbeatsSec: downbeats,
      sections: [],
    });

    expect(segments.length).toBeGreaterThanOrEqual(3);
    expect(segments.every((segment) => downbeats.includes(segment.startSec))).toBe(true);
    expect(segments.every((segment) => segment.endBeat - segment.startBeat >= 16)).toBe(true);
    expect(segments.some((segment) => segment.section === "drop")).toBe(true);
    expect(segments.some((segment) => segment.section === "breakdown")).toBe(true);
  });

  it("does not create short segments for noisy energy flips", () => {
    const samples = Array.from({ length: 128 }, (_, index) =>
      index % 2 === 0 ? 0.48 : 0.54
    );
    const segments = deriveAnalysisSegments({
      durationSec: 128,
      energySamples: samples,
      energySampleRate: 1,
      beatsSec: beats,
      downbeatsSec: downbeats,
      sections: [],
    });

    expect(segments.length).toBeLessThanOrEqual(4);
    expect(segments.every((segment) => segment.endSec - segment.startSec >= 32)).toBe(true);
  });

  it("scores entry segments from same track differently", () => {
    const samples = [
      ...Array(32).fill(0.1),
      ...Array.from({ length: 32 }, (_, index) => 0.2 + index / 50),
      ...Array(64).fill(0.9),
    ];
    const segments = deriveAnalysisSegments({
      durationSec: 128,
      energySamples: samples,
      energySampleRate: 1,
      beatsSec: beats,
      downbeatsSec: downbeats,
      sections: [],
    });

    expect(new Set(segments.map((segment) => segment.entryQuality)).size).toBeGreaterThan(1);
    expect(segments.find((segment) => segment.section === "buildup")?.entryQuality)
      .toBeGreaterThan(segments.find((segment) => segment.section === "drop")?.entryQuality ?? 1);
  });
});
