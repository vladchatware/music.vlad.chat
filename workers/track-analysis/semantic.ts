import type { AnalysisSegment } from "../../lib/trackAnalysis";

export type SemanticWindow = {
  startSec: number;
  endSec: number;
  vocalProbability: number;
  danceability?: number;
  approachability?: number;
  engagement?: number;
  valence?: number;
  arousal?: number;
  mirexMood?: Record<string, number>;
  themes?: Record<string, number>;
  instruments?: Record<string, number>;
  genres?: Record<string, number>;
  timbre?: Record<string, number>;
};

const round = (value: number) => Number(value.toFixed(4));
const overlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

export function enrichSegmentsWithSemantics(
  segments: AnalysisSegment[],
  windows: SemanticWindow[],
): AnalysisSegment[] {
  return segments.map((segment) => {
    const matching = windows
      .map((window) => ({ window, weight: overlap(segment.startSec, segment.endSec, window.startSec, window.endSec) }))
      .filter(({ weight }) => weight > 0);
    const totalWeight = matching.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight === 0) return segment;

    const vocalProbability = round(
      matching.reduce((sum, { window, weight }) => sum + window.vocalProbability * weight, 0) / totalWeight,
    );

    const weightedScalar = (field: "danceability" | "approachability" | "engagement" | "valence" | "arousal") => {
      const items = matching.filter(({ window }) => window[field] !== undefined);
      const weight = items.reduce((sum, item) => sum + item.weight, 0);
      return weight === 0 ? null : round(items.reduce(
        (sum, { window, weight: itemWeight }) => sum + (window[field] ?? 0) * itemWeight,
        0,
      ) / weight);
    };
    const weightedLabels = (field: "mirexMood" | "themes" | "instruments" | "genres" | "timbre") => {
      const items = matching.filter(({ window }) => window[field] !== undefined);
      const weight = items.reduce((sum, item) => sum + item.weight, 0);
      if (weight === 0) return null;
      const fieldLabels = new Set(items.flatMap(({ window }) => Object.keys(window[field] ?? {})));
      return Object.fromEntries([...fieldLabels].map((label) => [label, round(items.reduce(
        (sum, { window, weight: itemWeight }) => sum + (window[field]?.[label] ?? 0) * itemWeight,
        0,
      ) / weight)]));
    };

    return {
      ...segment,
      valence: weightedScalar("valence"),
      arousal: weightedScalar("arousal"),
      vocalProbability,
      danceability: weightedScalar("danceability"),
      approachability: weightedScalar("approachability"),
      engagement: weightedScalar("engagement"),
      mirexMood: weightedLabels("mirexMood"),
      themes: weightedLabels("themes"),
      instruments: weightedLabels("instruments"),
      genres: weightedLabels("genres"),
      timbre: weightedLabels("timbre"),
    };
  });
}
