import { describe, expect, it } from "vitest";

import type { AnalysisSegment } from "../../lib/trackAnalysis";
import { enrichSegmentsWithSemantics } from "./semantic";

const segment = (id: string, startSec: number, endSec: number): AnalysisSegment => ({
  id, startSec, endSec, startBeat: startSec * 2, endBeat: endSec * 2,
  section: "verse", energy: 0.5, energySlope: 0, rhythmicDensity: 0.5,
  entryQuality: 0.5, exitQuality: 0.5, confidence: 0.7,
  valence: null, arousal: null, vocalProbability: null,
  danceability: null, approachability: null, engagement: null,
  mirexMood: null, themes: null, instruments: null, genres: null, timbre: null,
});

describe("enrichSegmentsWithSemantics", () => {
  it("overlap-weights MIREX mood and vocal predictions per musical segment", () => {
    const result = enrichSegmentsWithSemantics(
      [segment("s0", 0, 10), segment("s1", 10, 20)],
      [
        { startSec: 0, endSec: 10, mirexMood: { cheerful: 0.8, wistful: 0.1 }, vocalProbability: 0.2 },
        { startSec: 5, endSec: 15, mirexMood: { cheerful: 0.4, wistful: 0.5 }, vocalProbability: 0.8 },
        { startSec: 10, endSec: 20, mirexMood: { cheerful: 0.1, wistful: 0.9 }, vocalProbability: 0.9 },
      ],
    );

    expect(result[0].mirexMood).toEqual({ cheerful: 0.6667, wistful: 0.2333 });
    expect(result[0].vocalProbability).toBe(0.4);
    expect(result[1].mirexMood).toEqual({ cheerful: 0.2, wistful: 0.7667 });
    expect(result[1].vocalProbability).toBeCloseTo(0.8667, 4);
  });

  it("keeps semantic fields null when inference returns no overlapping windows", () => {
    expect(enrichSegmentsWithSemantics([segment("s0", 0, 10)], [])[0]).toMatchObject({
      valence: null,
      arousal: null,
      vocalProbability: null,
    });
  });

  it("persists only MIREX mood scores", () => {
    const result = enrichSegmentsWithSemantics([segment("s0", 0, 10)], [{
      startSec: 0,
      endSec: 10,
      vocalProbability: 0.2,
      valence: 0.4,
      arousal: 0.7,
      mirexMood: { wistful: 0.8 },
    }])[0];
    expect(result).toMatchObject({
      valence: 0.4,
      arousal: 0.7,
      mirexMood: { wistful: 0.8 },
    });
  });
});
