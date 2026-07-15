import { describe, expect, it } from "vitest";

import { createEffnetPatches, hasAudibleSignal, mirexMoodScores, probabilityForClass, topLabelScores } from "./semanticModels";

describe("probabilityForClass", () => {
  it("averages frame activations for requested class", () => {
    expect(probabilityForClass([[0.8, 0.2], [0.6, 0.4]], 0)).toBe(0.7);
    expect(probabilityForClass([[0.8, 0.2], [0.6, 0.4]], 1)).toBe(0.3);
  });

  it("returns zero for malformed model output", () => {
    expect(probabilityForClass([], 0)).toBe(0);
    expect(probabilityForClass([[Number.NaN]], 0)).toBe(0);
  });
});

describe("hasAudibleSignal", () => {
  it("rejects silence that Essentia mel extraction cannot analyze", () => {
    expect(hasAudibleSignal(new Float32Array(16_000))).toBe(false);
    const signal = new Float32Array(16_000);
    signal[100] = 0.1;
    expect(hasAudibleSignal(signal)).toBe(true);
  });
});

describe("EffNet helpers", () => {
  it("builds overlapping 128-frame patches at 62-frame hops", () => {
    const melSpectrum = Array.from({ length: 314 }, (_, frame) => Array(96).fill(frame));
    const patches = createEffnetPatches({ melSpectrum, frameSize: 314, melBandsSize: 96, patchSize: 187 });
    expect(patches.count).toBe(4);
    expect(patches.data[0]).toBe(0);
    expect(patches.data[128 * 96]).toBe(62);
  });

  it("drops low-value label noise before persistence", () => {
    expect(topLabelScores({ weak: 0.01, useful: 0.6, second: 0.3 }, 2)).toEqual({ useful: 0.6, second: 0.3 });
  });
});

describe("MIREX mood mapping", () => {
  it("maps classifier rows to named mood scores", () => {
    expect(mirexMoodScores(
      [[0.2, 0.8], [0.4, 0.6]],
      ["rousing", "cheerful"],
    )).toEqual({ rousing: 0.3, cheerful: 0.7 });
  });
});
