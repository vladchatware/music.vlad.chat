import type { DJPerformancePlan } from "../performance/types";

type ScoredSegment = {
  id: string;
  startSec: number;
  endSec: number;
  section: string;
  energy: number;
  energySlope: number;
  rhythmicDensity?: number;
  entryQuality?: number;
  exitQuality?: number;
  confidence?: number;
  vocalProbability?: number | null;
  mirexMood?: Record<string, number> | null;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export type SegmentPairScore = {
  overall: number;
  energyContinuity: number;
  slopeContinuity: number;
  rhythmContinuity: number;
  cueQuality: number;
  vocalSafety: number;
  moodCompatibility: number;
  confidence: number;
};

function moodSimilarity(
  outgoing: Record<string, number> | null | undefined,
  incoming: Record<string, number> | null | undefined,
): number | null {
  if (!outgoing || !incoming) return null;
  const labels = new Set([...Object.keys(outgoing), ...Object.keys(incoming)]);
  let dot = 0;
  let outgoingNorm = 0;
  let incomingNorm = 0;
  for (const label of labels) {
    const left = outgoing[label] ?? 0;
    const right = incoming[label] ?? 0;
    dot += left * right;
    outgoingNorm += left * left;
    incomingNorm += right * right;
  }
  return outgoingNorm > 0 && incomingNorm > 0
    ? clamp01(dot / Math.sqrt(outgoingNorm * incomingNorm))
    : null;
}

export function scoreSegmentPair(
  outgoing: ScoredSegment,
  incoming: ScoredSegment,
  energyArc: DJPerformancePlan["energyArc"],
): SegmentPairScore {
  const delta = incoming.energy - outgoing.energy;
  const energyContinuity = energyArc === "build"
    ? clamp01(1 - Math.abs(Math.max(0, delta) - 0.12) / 0.5)
    : energyArc === "release"
      ? clamp01(1 - Math.abs(Math.min(0, delta) + 0.18) / 0.5)
      : energyArc === "reset"
        ? clamp01(Math.abs(delta) / 0.6)
        : clamp01(1 - Math.abs(delta));
  const slopeContinuity = clamp01(1 - Math.abs(incoming.energySlope - outgoing.energySlope) / 0.04);
  const rhythmContinuity = outgoing.rhythmicDensity === undefined || incoming.rhythmicDensity === undefined
    ? 0.5
    : clamp01(1 - Math.abs(incoming.rhythmicDensity - outgoing.rhythmicDensity));
  const cueQuality = clamp01(((outgoing.exitQuality ?? 0.5) + (incoming.entryQuality ?? 0.5)) / 2);
  const vocalSafety = outgoing.vocalProbability == null || incoming.vocalProbability == null
    ? 0.5
    : clamp01(1 - outgoing.vocalProbability * incoming.vocalProbability);
  const similarity = moodSimilarity(outgoing.mirexMood, incoming.mirexMood);
  const moodCompatibility = similarity === null
    ? 0.5
    : energyArc === "reset" ? 1 - similarity : similarity;
  const confidence = clamp01(((outgoing.confidence ?? 0.5) + (incoming.confidence ?? 0.5)) / 2);
  const overall =
    energyContinuity * 0.29 +
    slopeContinuity * 0.18 +
    rhythmContinuity * 0.14 +
    cueQuality * 0.19 +
    vocalSafety * 0.06 +
    moodCompatibility * 0.08 +
    confidence * 0.06;

  return {
    overall: Number(overall.toFixed(4)),
    energyContinuity: Number(energyContinuity.toFixed(4)),
    slopeContinuity: Number(slopeContinuity.toFixed(4)),
    rhythmContinuity: Number(rhythmContinuity.toFixed(4)),
    cueQuality: Number(cueQuality.toFixed(4)),
    vocalSafety: Number(vocalSafety.toFixed(4)),
    moodCompatibility: Number(moodCompatibility.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
  };
}
