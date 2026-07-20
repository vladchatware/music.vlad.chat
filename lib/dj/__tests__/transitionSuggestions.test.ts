import { describe, expect, it } from "vitest";

import type { AnalysisSegment, TrackAnalysis } from "../../trackAnalysis";
import { rankTransitionCandidates, suggestTransitionWindows } from "../segments/suggestions";

function segment(
  id: string,
  startSec: number,
  overrides: Partial<AnalysisSegment> = {},
): AnalysisSegment {
  return {
    id,
    startSec,
    endSec: startSec + 8,
    startBeat: startSec * 2,
    endBeat: startSec * 2 + 16,
    section: "verse",
    energy: 0.6,
    energySlope: 0.004,
    rhythmicDensity: 0.65,
    entryQuality: 0.75,
    exitQuality: 0.75,
    confidence: 0.85,
    valence: null,
    arousal: null,
    vocalProbability: 0.15,
    danceability: null,
    approachability: null,
    engagement: null,
    mirexMood: { energetic: 0.8 },
    themes: null,
    instruments: null,
    genres: null,
    timbre: null,
    ...overrides,
  };
}

function analysis(
  id: string,
  bpm: number,
  segments: AnalysisSegment[],
  overrides: Partial<TrackAnalysis> = {},
): TrackAnalysis {
  const durationSec = 240;
  const beatDuration = 60 / bpm;
  return {
    source: "soundcloud",
    sourceTrackId: id,
    analysisVersion: "essentia-dj-v7",
    durationSec,
    processingTimeMs: 1,
    warnings: [],
    tempo: {
      bpm,
      confidence: 0.9,
      beatsSec: Array.from({ length: Math.floor(durationSec / beatDuration) }, (_, index) => index * beatDuration),
      firstDownbeatSec: 0,
      downbeatsSec: [],
      downbeatConfidence: 0.9,
    },
    tonal: { key: "A", scale: "minor", camelotKey: "8A", confidence: 0.9 },
    energy: { sampleRate: 1, samples: [], peaks: [], valleys: [] },
    structure: { phrases: [], downbeats: [], sections: [] },
    segments,
    cuePoints: { mixInSec: 8, mixOutSec: 200, confidence: 0.8, reason: "fixture" },
    ...overrides,
  };
}

describe("suggestTransitionWindows", () => {
  it("ranks compatible segment pairs and returns deterministic limits", () => {
    const outgoing = analysis("1", 120, [
      segment("out-a", 160, { energy: 0.65, exitQuality: 0.95 }),
      segment("out-b", 176, { energy: 0.25, exitQuality: 0.55 }),
    ]);
    const incoming = analysis("2", 120, [
      segment("in-a", 16, { energy: 0.66, entryQuality: 0.95 }),
      segment("in-b", 32, { energy: 0.2, entryQuality: 0.55 }),
    ]);

    const suggestions = suggestTransitionWindows({ outgoing, incoming, energyArc: "preserve", limit: 2 });

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].id).toBe("out-a:in-a");
    expect(suggestions[0].outgoing).toMatchObject({ startSec: 160, endSec: 168 });
    expect(suggestions[0].incoming).toMatchObject({ startSec: 16, endSec: 24 });
    expect(suggestTransitionWindows({ outgoing, incoming, energyArc: "preserve", limit: 1 })[0])
      .toEqual(suggestions[0]);
  });

  it("changes ranking with energy arc", () => {
    const outgoing = analysis("1", 120, [segment("out", 160, { energy: 0.5 })]);
    const incoming = analysis("2", 120, [
      segment("steady", 16, { energy: 0.52 }),
      segment("build", 32, { energy: 0.63 }),
      segment("release", 48, { energy: 0.32 }),
      segment("reset", 64, { energy: 0.95 }),
    ]);

    expect(suggestTransitionWindows({ outgoing, incoming, energyArc: "preserve", limit: 1 })[0].incoming.segmentId).toBe("steady");
    expect(suggestTransitionWindows({ outgoing, incoming, energyArc: "build", limit: 1 })[0].incoming.segmentId).toBe("build");
    expect(suggestTransitionWindows({ outgoing, incoming, energyArc: "release", limit: 1 })[0].incoming.segmentId).toBe("release");
    expect(suggestTransitionWindows({ outgoing, incoming, energyArc: "reset", limit: 1 })[0].incoming.segmentId).toBe("reset");
  });

  it("rejects infeasible tempo and unreliable analysis", () => {
    const outgoing = analysis("1", 120, [segment("out", 160)]);
    const incompatible = analysis("2", 90, [segment("in", 16)]);
    const unreliable = analysis("3", 120, [segment("in", 16)], {
      tempo: { ...outgoing.tempo, confidence: 0.1 },
    });

    expect(suggestTransitionWindows({ outgoing, incoming: incompatible, energyArc: "preserve" })).toEqual([]);
    expect(suggestTransitionWindows({ outgoing, incoming: unreliable, energyArc: "preserve" })).toEqual([]);
  });

  it("converts incoming source range using playback rate", () => {
    const outgoing = analysis("1", 120, [segment("out", 160)]);
    const incoming = analysis("2", 125, [segment("in", 16, { endSec: 25 })]);

    const [suggestion] = suggestTransitionWindows({ outgoing, incoming, energyArc: "preserve" });

    expect(suggestion.incomingPlaybackRate).toBeCloseTo(0.96, 4);
    expect(suggestion.wallDurationSec).toBe(8);
    expect(suggestion.incoming.endSec).toBeCloseTo(23.68, 4);
  });

  it("rejects windows with less than one bar runway", () => {
    const outgoing = analysis("1", 120, [segment("short", 239, { endSec: 240 })]);
    const incoming = analysis("2", 120, [segment("in", 16)]);

    expect(suggestTransitionWindows({ outgoing, incoming, energyArc: "preserve" })).toEqual([]);
  });

  it("uses harmonic compatibility in overall score", () => {
    const outgoing = analysis("1", 120, [segment("out", 160)]);
    const compatible = analysis("2", 120, [segment("in", 16)]);
    const clashing = analysis("3", 120, [segment("in", 16)], {
      tonal: { key: "E-flat", scale: "major", camelotKey: "5B", confidence: 0.9 },
    });

    const compatibleScore = suggestTransitionWindows({ outgoing, incoming: compatible, energyArc: "preserve" })[0].score;
    const clashingScore = suggestTransitionWindows({ outgoing, incoming: clashing, energyArc: "preserve" })[0].score;
    expect(compatibleScore).toBeGreaterThan(clashingScore);
  });

  it("ranks candidate tracks by their best window and excludes current track", () => {
    const outgoing = analysis("1", 120, [segment("out", 160, { energy: 0.6 })]);
    const strong = analysis("2", 120, [segment("strong", 16, { energy: 0.61, entryQuality: 0.95 })]);
    const weak = analysis("3", 120, [segment("weak", 16, { energy: 0.1, entryQuality: 0.4 })]);

    const ranked = rankTransitionCandidates({
      outgoing,
      candidates: [weak, outgoing, strong],
      energyArc: "preserve",
      limit: 2,
    });

    expect(ranked.map(({ analysis: candidate }) => candidate.sourceTrackId)).toEqual(["2", "3"]);
    expect(ranked[0].suggestions).toHaveLength(1);
  });
});
