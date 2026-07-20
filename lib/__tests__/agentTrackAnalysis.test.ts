import { describe, expect, it } from "vitest";

import { formatTrackAnalysisForAgent } from "../agentTrackAnalysis";
import type { TrackAnalysis } from "../trackAnalysis";

const analysis: TrackAnalysis = {
  source: "soundcloud",
  sourceTrackId: "42",
  analysisVersion: "essentia-dj-v1",
  durationSec: 180,
  processingTimeMs: 10,
  warnings: [],
  semantic: { status: "ready", models: ["mood_happy", "voice_instrumental"], sampleRate: 16_000, windowSec: 10, hopSec: 5 },
  tempo: {
    bpm: 124,
    confidence: 0.9,
    beatsSec: [0, 0.5, 1],
    firstDownbeatSec: 0,
    downbeatsSec: [0, 2, 4],
    downbeatConfidence: 0.8,
  },
  tonal: { key: "A", scale: "minor", camelotKey: "8A", confidence: 0.85 },
  energy: { sampleRate: 2, samples: [0.2, 0.4, 0.8, 0.3], peaks: [2], valleys: [0, 3] },
  structure: {
    phrases: [],
    downbeats: [0, 2, 4],
    sections: [
      { type: "intro", phrases: [], startTime: 0, endTime: 16, energy: 0.2 },
      { type: "drop", phrases: [], startTime: 64, endTime: 128, energy: 0.8 },
    ],
  },
  cuePoints: { mixInSec: 16, mixOutSec: 160, confidence: 0.8, reason: "fixture" },
  segments: [],
};

describe("formatTrackAnalysisForAgent", () => {
  it("returns compact summary without raw arrays", () => {
    const result = formatTrackAnalysisForAgent(analysis, "summary");
    expect(result).toMatchObject({
      trackId: "42",
      tempo: { bpm: 124, confidence: 0.9 },
      tonal: { camelotKey: "8A" },
      energy: { mean: 0.425, peak: 0.8, entry: 0.2, exit: 0.3 },
      cuePoints: { mixInSec: 16, mixOutSec: 160 },
      semantic: { status: "ready" },
    });
    expect(JSON.stringify(result)).not.toContain("beatsSec");
    expect(JSON.stringify(result)).not.toContain("samples");
  });

  it("returns only requested detailed facet", () => {
    expect(formatTrackAnalysisForAgent(analysis, "timing")).toEqual({
      trackId: "42",
      durationSec: 180,
      tempo: {
        bpm: 124,
        confidence: 0.9,
        firstDownbeatSec: 0,
        downbeatConfidence: 0.8,
        beatCount: 3,
        downbeatCount: 3,
      },
      cuePoints: analysis.cuePoints,
    });
    expect(formatTrackAnalysisForAgent(analysis, "energy")).toMatchObject({
      trackId: "42",
      durationSec: 180,
      energy: { mean: 0.425, peak: 0.8, entry: 0.2, exit: 0.3 },
    });
    expect(JSON.stringify(formatTrackAnalysisForAgent(analysis, "full"))).not.toContain("beatsSec");
    expect(JSON.stringify(formatTrackAnalysisForAgent(analysis, "full"))).not.toContain("samples");
  });

  it("returns only compact candidate entry options in summary", () => {
    const result = formatTrackAnalysisForAgent({
      ...analysis,
      segments: [
        {
          id: "s0", startSec: 0, endSec: 32, startBeat: 0, endBeat: 64,
          section: "intro", energy: 0.2, energySlope: 0.01, rhythmicDensity: 0.2,
          entryQuality: 0.9, exitQuality: 0.4, confidence: 0.8,
          valence: 0.8, arousal: 0.6, vocalProbability: 0.2,
          danceability: null, approachability: null, engagement: null,
          mirexMood: { cheerful: 0.7 }, themes: null, instruments: null, genres: null, timbre: null,
        },
        {
          id: "s1", startSec: 32, endSec: 64, startBeat: 64, endBeat: 128,
          section: "drop", energy: 0.85, energySlope: -0.01, rhythmicDensity: 0.8,
          entryQuality: 0.5, exitQuality: 0.85, confidence: 0.75,
          valence: null, arousal: null, vocalProbability: null,
          danceability: null, approachability: null, engagement: null,
          mirexMood: null, themes: null, instruments: null, genres: null, timbre: null,
        },
      ],
    }, "summary") as { entryOptions: Array<{ startSec: number; mirexMood?: Record<string, number> }> };

    expect(result.entryOptions[0]?.startSec).toBe(0);
    expect(result.entryOptions[0]).toMatchObject({ mirexMood: { cheerful: 0.7 }, vocalProbability: 0.2 });
    expect(JSON.stringify(result)).not.toContain("exitSegments");
    expect(JSON.stringify(result)).not.toContain("sections");
    expect(JSON.stringify(result).length).toBeLessThan(900);
    expect(JSON.stringify(result)).not.toContain("timbre");
  });
});
