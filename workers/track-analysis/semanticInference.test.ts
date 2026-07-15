import { describe, expect, it } from "vitest";

import { analyzeSemanticWindows } from "./semanticInference";

describe("analyzeSemanticWindows", () => {
  it("runs overlapping 10-second windows with a 5-second hop", async () => {
    const seen: number[] = [];
    const windows = await analyzeSemanticWindows(
      new Float32Array(22_050 * 21),
      async (audio) => {
        seen.push(audio.length);
        return { mirexMood: { cheerful: 0.7 }, vocalProbability: 0.25 };
      },
    );

    expect(windows.map(({ startSec, endSec }) => [startSec, endSec])).toEqual([
      [0, 10], [5, 15], [10, 20], [15, 21],
    ]);
    expect(seen.slice(0, 3)).toEqual([160_000, 160_000, 160_000]);
    expect(seen[3]).toBe(96_000);
  });

  it("bounds classifier outputs to probabilities", async () => {
    const [window] = await analyzeSemanticWindows(
      new Float32Array(22_050 * 10),
      async () => ({ mirexMood: { cheerful: 1.2, wistful: -0.1 }, vocalProbability: Number.NaN }),
    );
    expect(window).toMatchObject({ mirexMood: { cheerful: 1, wistful: 0 }, vocalProbability: 0 });
  });
});
