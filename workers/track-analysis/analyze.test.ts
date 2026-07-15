import { describe, expect, it } from "vitest";
import {
  analyzePcm,
  computeEnergy,
  deriveCuePoints,
  estimateDownbeats,
} from "./analyze";
import { ANALYSIS_SAMPLE_RATE } from "./config";

function makeClickTrack(durationSec: number, bpm: number): Float32Array {
  const signal = new Float32Array(durationSec * ANALYSIS_SAMPLE_RATE);
  const beatSamples = Math.round((60 / bpm) * ANALYSIS_SAMPLE_RATE);
  for (let beat = 0; beat * beatSamples < signal.length; beat += 1) {
    const start = beat * beatSamples;
    const gain = beat % 4 === 0 ? 1 : 0.45;
    for (let index = 0; index < 800 && start + index < signal.length; index += 1) {
      signal[start + index] += gain * Math.exp(-index / 180) * Math.sin((2 * Math.PI * 120 * index) / ANALYSIS_SAMPLE_RATE);
    }
  }
  return signal;
}

describe("track analyzer", () => {
  it("derives a phrase-sized non-zero mix-in when structure starts at zero", () => {
    const cue = deriveCuePoints(180, 120, [
      { type: "drop", startTime: 0, endTime: 180 },
    ]);
    expect(cue.mixInSec).toBe(16);
    expect(cue.reason).toBe("phrase-sized entry and exit");
  });

  it("prefers a later analyzed section boundary", () => {
    const cue = deriveCuePoints(180, 120, [
      { type: "intro", startTime: 0, endTime: 24 },
      { type: "drop", startTime: 24, endTime: 140 },
    ]);
    expect(cue.mixInSec).toBe(24);
    expect(cue.reason).toBe("section-aligned entry");
  });

  it("produces normalized 2 Hz energy and extrema", () => {
    const signal = makeClickTrack(8, 120);
    const energy = computeEnergy(signal);
    expect(energy.samples).toHaveLength(16);
    expect(Math.max(...energy.samples)).toBeLessThanOrEqual(1);
    expect(Math.min(...energy.samples)).toBeGreaterThanOrEqual(0);
    expect(energy.peaks.length + energy.valleys.length).toBeGreaterThan(0);
  });

  it("finds strongest four-beat phase as downbeat", () => {
    const signal = makeClickTrack(12, 120);
    const beats = Array.from({ length: 24 }, (_, index) => index * 0.5);
    const result = estimateDownbeats(signal, beats);
    expect(result.firstDownbeatSec).toBe(0);
    expect(result.downbeatsSec.slice(0, 3)).toEqual([0, 2, 4]);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns bounded DJ metadata for PCM", () => {
    const signal = makeClickTrack(40, 120);
    const result = analyzePcm(signal, "123", "essentia-dj-v1", Date.now());
    expect(result.sourceTrackId).toBe("123");
    expect(result.durationSec).toBeCloseTo(40, 3);
    expect(result.tempo.bpm).toBeGreaterThanOrEqual(40);
    expect(result.tempo.bpm).toBeLessThanOrEqual(200);
    expect(result.energy.samples).toHaveLength(80);
    expect(result.structure.sections.length).toBeGreaterThan(0);
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments.every((segment) => segment.endBeat - segment.startBeat >= 16)).toBe(true);
    expect(result.cuePoints.mixInSec).toBe(
      result.segments
        .filter((segment) => segment.startSec <= result.durationSec * 0.35)
        .sort((a, b) => b.entryQuality - a.entryQuality)[0]?.startSec,
    );
    expect(result.cuePoints.mixInSec).toBeGreaterThanOrEqual(0);
    expect(result.cuePoints.mixOutSec).toBeLessThan(result.durationSec);
  }, 10_000);
});
