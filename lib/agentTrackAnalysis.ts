import type { TrackAnalysis } from "./trackAnalysis";

export type TrackAnalysisAspect = "summary" | "timing" | "structure" | "energy" | "full";

function summarizeEnergy(samples: number[]) {
  const mean = samples.length > 0
    ? samples.reduce((sum, value) => sum + value, 0) / samples.length
    : 0;
  return {
    mean: Number(mean.toFixed(4)),
    peak: samples.length > 0 ? Math.max(...samples) : 0,
    entry: samples[0] ?? 0,
    exit: samples.at(-1) ?? 0,
  };
}

function energyTrajectory(samples: number[], bins = 12): number[] {
  if (samples.length === 0) return [];
  const size = Math.max(1, Math.ceil(samples.length / bins));
  const result: number[] = [];
  for (let offset = 0; offset < samples.length; offset += size) {
    const slice = samples.slice(offset, offset + size);
    result.push(Number((slice.reduce((sum, value) => sum + value, 0) / slice.length).toFixed(3)));
  }
  return result;
}

function timingView(analysis: TrackAnalysis) {
  return {
    bpm: analysis.tempo.bpm,
    confidence: analysis.tempo.confidence,
    firstDownbeatSec: analysis.tempo.firstDownbeatSec,
    downbeatConfidence: analysis.tempo.downbeatConfidence,
    beatCount: analysis.tempo.beatsSec.length,
    downbeatCount: analysis.tempo.downbeatsSec.length,
  };
}

function structureView(analysis: TrackAnalysis) {
  return analysis.structure.sections.map((section) => ({
    type: section.type,
    startTime: section.startTime,
    endTime: section.endTime,
    energy: section.energy,
  }));
}

function topScores(values: Record<string, number> | null, limit = 3) {
  if (!values) return undefined;
  const entries = Object.entries(values)
    .filter(([, score]) => score >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function segmentView(segment: TrackAnalysis["segments"][number], detailed = false) {
  return {
    ...(detailed ? { id: segment.id, endSec: segment.endSec } : {}),
    startSec: segment.startSec,
    section: segment.section,
    energy: segment.energy,
    energySlope: segment.energySlope,
    rhythmicDensity: segment.rhythmicDensity,
    entryQuality: segment.entryQuality,
    ...(detailed ? { exitQuality: segment.exitQuality } : {}),
    confidence: segment.confidence,
    ...(segment.valence === null ? {} : { valence: segment.valence }),
    ...(segment.arousal === null ? {} : { arousal: segment.arousal }),
    ...(segment.vocalProbability === null ? {} : { vocalProbability: segment.vocalProbability }),
    ...(segment.danceability === null ? {} : { danceability: segment.danceability }),
    ...(segment.approachability === null ? {} : { approachability: segment.approachability }),
    ...(segment.engagement === null ? {} : { engagement: segment.engagement }),
    mirexMood: topScores(segment.mirexMood, 3),
    themes: topScores(segment.themes, 3),
    instruments: topScores(segment.instruments, 3),
    genres: topScores(segment.genres, 3),
    timbre: topScores(segment.timbre, 2),
  };
}

function rankedSegments(analysis: TrackAnalysis) {
  const segments = analysis.segments ?? [];
  return {
    entrySegments: [...segments]
      .sort((a, b) => b.entryQuality - a.entryQuality)
      .slice(0, 4)
      .map((segment) => segmentView(segment, true)),
    exitSegments: [...segments]
      .sort((a, b) => b.exitQuality - a.exitQuality)
      .slice(0, 4)
      .map((segment) => segmentView(segment, true)),
  };
}

function semanticView(analysis: TrackAnalysis) {
  return analysis.semantic ? {
    status: analysis.semantic.status,
  } : undefined;
}

function entryOptions(analysis: TrackAnalysis) {
  return [...(analysis.segments ?? [])]
    .sort((a, b) => b.entryQuality - a.entryQuality)
    .slice(0, 3)
    .map((segment) => segmentView(segment));
}

export function formatTrackAnalysisForAgent(
  analysis: TrackAnalysis,
  aspect: TrackAnalysisAspect,
): unknown {
  if (aspect === "full") {
    return {
      trackId: analysis.sourceTrackId,
      durationSec: analysis.durationSec,
      warnings: analysis.warnings,
      semantic: semanticView(analysis),
      tempo: timingView(analysis),
      tonal: analysis.tonal,
      energy: {
        ...summarizeEnergy(analysis.energy.samples),
        trajectory: energyTrajectory(analysis.energy.samples),
      },
      sections: structureView(analysis),
      ...rankedSegments(analysis),
      cuePoints: analysis.cuePoints,
    };
  }
  if (aspect === "timing") {
    return {
      trackId: analysis.sourceTrackId,
      durationSec: analysis.durationSec,
      tempo: timingView(analysis),
      cuePoints: analysis.cuePoints,
    };
  }
  if (aspect === "structure") {
    return {
      trackId: analysis.sourceTrackId,
      durationSec: analysis.durationSec,
      sections: structureView(analysis),
      segments: (analysis.segments ?? []).map((segment) => segmentView(segment, true)),
      cuePoints: analysis.cuePoints,
    };
  }
  if (aspect === "energy") {
    return {
      trackId: analysis.sourceTrackId,
      durationSec: analysis.durationSec,
      energy: {
        ...summarizeEnergy(analysis.energy.samples),
        trajectory: energyTrajectory(analysis.energy.samples),
      },
    };
  }
  return {
    trackId: analysis.sourceTrackId,
    durationSec: analysis.durationSec,
    ...(analysis.warnings.length > 0 ? { warnings: analysis.warnings } : {}),
    semantic: semanticView(analysis),
    tempo: {
      bpm: analysis.tempo.bpm,
      confidence: analysis.tempo.confidence,
      downbeatConfidence: analysis.tempo.downbeatConfidence,
    },
    tonal: analysis.tonal,
    energy: summarizeEnergy(analysis.energy.samples),
    entryOptions: entryOptions(analysis),
    cuePoints: analysis.cuePoints,
  };
}
