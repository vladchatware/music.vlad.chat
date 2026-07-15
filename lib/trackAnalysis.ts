import type {
  CamelotKey,
  EnergyCurve,
  Phrase,
  PhraseType,
  Section,
  StructureMap,
} from "./dj/types";

export const TRACK_ANALYSIS_VERSION = "essentia-dj-v6";
export const TRACK_ANALYSIS_SOURCE = "soundcloud";

export type TrackCuePoints = {
  mixInSec: number;
  mixOutSec: number;
  confidence: number;
  reason: string;
};

export type SerializedEnergyCurve = {
  sampleRate: number;
  samples: number[];
  peaks: number[];
  valleys: number[];
};

export type SerializedStructureMap = {
  phrases: Phrase[];
  downbeats: number[];
  sections: Section[];
};

export type AnalysisSegment = {
  id: string;
  startSec: number;
  endSec: number;
  startBeat: number;
  endBeat: number;
  section: PhraseType;
  energy: number;
  energySlope: number;
  rhythmicDensity: number;
  entryQuality: number;
  exitQuality: number;
  confidence: number;
  valence: number | null;
  arousal: number | null;
  vocalProbability: number | null;
  danceability: number | null;
  approachability: number | null;
  engagement: number | null;
  mirexMood: Record<string, number> | null;
  themes: Record<string, number> | null;
  instruments: Record<string, number> | null;
  genres: Record<string, number> | null;
  timbre: Record<string, number> | null;
};

export type TrackAnalysis = {
  source: typeof TRACK_ANALYSIS_SOURCE;
  sourceTrackId: string;
  analysisVersion: typeof TRACK_ANALYSIS_VERSION | string;
  durationSec: number;
  processingTimeMs: number;
  warnings: string[];
  semantic?: {
    status: "ready" | "unavailable";
    models: string[];
    sampleRate: number;
    windowSec: number;
    hopSec: number;
  };
  tempo: {
    bpm: number;
    confidence: number;
    beatsSec: number[];
    firstDownbeatSec: number;
    downbeatsSec: number[];
    downbeatConfidence: number;
  };
  tonal: {
    key: string;
    scale: string;
    camelotKey?: CamelotKey;
    confidence: number;
  };
  energy: SerializedEnergyCurve;
  structure: SerializedStructureMap;
  segments: AnalysisSegment[];
  cuePoints: TrackCuePoints;
};

export function analysisCacheKey(
  trackId: string | number,
  version = TRACK_ANALYSIS_VERSION,
): string {
  return `${TRACK_ANALYSIS_SOURCE}:${String(trackId)}:${version}`;
}

export function toEnergyCurve(
  analysis: TrackAnalysis,
): EnergyCurve {
  return {
    samples: Float32Array.from(analysis.energy.samples),
    sampleRate: analysis.energy.sampleRate,
    peaks: analysis.energy.peaks,
    valleys: analysis.energy.valleys,
    duration: analysis.durationSec,
  };
}

export function toStructureMap(
  analysis: TrackAnalysis,
): StructureMap {
  return {
    phrases: analysis.structure.phrases,
    downbeats: analysis.structure.downbeats,
    sections: analysis.structure.sections,
    duration: analysis.durationSec,
  };
}

export function isPhraseType(value: string): value is PhraseType {
  return [
    "intro",
    "verse",
    "buildup",
    "drop",
    "breakdown",
    "outro",
    "unknown",
  ].includes(value);
}
