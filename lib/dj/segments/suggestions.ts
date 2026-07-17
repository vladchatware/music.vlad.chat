import type { TrackAnalysis } from "../../trackAnalysis";
import { getCompatibility, parseKey } from "../harmonic";
import type { DJPerformancePlan } from "../performance/types";
import { matchTempo } from "../tempo";
import type {
  HarmonicScore,
  PhraseType,
  TempoMatchResult,
} from "../types";
import { scoreSegmentPair, type SegmentPairScore } from "./scoring";

export type TransitionSuggestionInput = {
  outgoing: TrackAnalysis;
  incoming: TrackAnalysis;
  energyArc: DJPerformancePlan["energyArc"];
  limit?: number;
};

export type TransitionWindow = {
  startSec: number;
  endSec: number;
  segmentId: string;
  section: PhraseType;
};

export type TransitionSuggestion = {
  id: string;
  outgoing: TransitionWindow;
  incoming: TransitionWindow;
  wallDurationSec: number;
  bars: number;
  incomingPlaybackRate: number;
  tempo: TempoMatchResult;
  harmonic: HarmonicScore;
  segment: SegmentPairScore;
  score: number;
  reasons: string[];
};

export type RankedTransitionCandidate = {
  analysis: TrackAnalysis;
  suggestions: TransitionSuggestion[];
  score: number;
};

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

function keyOf(analysis: TrackAnalysis) {
  if (analysis.tonal.confidence < 0.25) return null;
  return analysis.tonal.camelotKey ?? parseKey(
    `${analysis.tonal.key}${analysis.tonal.scale.toLowerCase().startsWith("minor") ? "m" : ""}`,
  );
}

function harmonicScore(outgoing: TrackAnalysis, incoming: TrackAnalysis): HarmonicScore {
  const outgoingKey = keyOf(outgoing);
  const incomingKey = keyOf(incoming);
  if (!outgoingKey || !incomingKey) {
    return {
      compatibility: 0.5,
      relationship: "unknown",
      suggestedPitchShift: 0,
      recommended: false,
    };
  }
  return getCompatibility(outgoingKey, incomingKey);
}

function reasonsFor(
  segment: SegmentPairScore,
  harmonic: HarmonicScore,
  tempo: TempoMatchResult,
): string[] {
  const ranked = [
    { label: "matched energy", value: segment.energyContinuity },
    { label: "aligned movement", value: segment.slopeContinuity },
    { label: "matched rhythm", value: segment.rhythmContinuity },
    { label: "safe cues", value: segment.cueQuality },
    { label: "clean vocal overlap", value: segment.vocalSafety },
    { label: "matched mood", value: segment.moodCompatibility },
  ].sort((a, b) => b.value - a.value);
  const reasons = ranked.slice(0, 2).map(({ label }) => label);
  if (harmonic.recommended || harmonic.compatibility >= 0.75) reasons.push("compatible key");
  else if (tempo.confidence >= 0.7) reasons.push("stable tempo lock");
  else reasons.push("phrase aligned");
  return reasons;
}

export function suggestTransitionWindows({
  outgoing,
  incoming,
  energyArc,
  limit = 3,
}: TransitionSuggestionInput): TransitionSuggestion[] {
  if (limit <= 0 || outgoing.tempo.confidence < 0.25 || incoming.tempo.confidence < 0.25) {
    return [];
  }

  const outgoingGrid = {
    bpm: outgoing.tempo.bpm,
    beatsPerBar: 4,
    firstDownbeat: outgoing.tempo.firstDownbeatSec,
    beats: outgoing.tempo.beatsSec,
    confidence: outgoing.tempo.confidence,
  };
  const incomingGrid = {
    bpm: incoming.tempo.bpm,
    beatsPerBar: 4,
    firstDownbeat: incoming.tempo.firstDownbeatSec,
    beats: incoming.tempo.beatsSec,
    confidence: incoming.tempo.confidence,
  };
  const tempo = matchTempo(outgoingGrid, incomingGrid);
  if (!tempo.feasible) return [];

  const harmonic = harmonicScore(outgoing, incoming);
  const barDurationSec = (60 / outgoing.tempo.bpm) * 4;
  const requestedWallDurationSec = Math.min(32, barDurationSec * 4);
  const candidates: TransitionSuggestion[] = [];

  for (const outgoingSegment of outgoing.segments) {
    const outgoingAvailable = Math.min(
      outgoingSegment.endSec,
      outgoing.durationSec,
    ) - outgoingSegment.startSec;
    for (const incomingSegment of incoming.segments) {
      const incomingSourceAvailable = Math.min(
        incomingSegment.endSec,
        incoming.durationSec,
      ) - incomingSegment.startSec;
      const wallDurationSec = Math.min(
        requestedWallDurationSec,
        outgoingAvailable,
        incomingSourceAvailable / tempo.targetPlaybackRate,
      );
      if (!Number.isFinite(wallDurationSec) || wallDurationSec + 0.001 < barDurationSec) continue;

      const segment = scoreSegmentPair(outgoingSegment, incomingSegment, energyArc);
      const score = round(
        segment.overall * 0.6 +
        harmonic.compatibility * 0.2 +
        tempo.confidence * 0.2,
      );
      const outgoingEndSec = Math.min(
        outgoing.durationSec,
        outgoingSegment.startSec + wallDurationSec,
      );
      const incomingEndSec = Math.min(
        incoming.durationSec,
        incomingSegment.startSec + wallDurationSec * tempo.targetPlaybackRate,
      );

      candidates.push({
        id: `${outgoingSegment.id}:${incomingSegment.id}`,
        outgoing: {
          startSec: outgoingSegment.startSec,
          endSec: round(outgoingEndSec),
          segmentId: outgoingSegment.id,
          section: outgoingSegment.section,
        },
        incoming: {
          startSec: incomingSegment.startSec,
          endSec: round(incomingEndSec),
          segmentId: incomingSegment.id,
          section: incomingSegment.section,
        },
        wallDurationSec: round(wallDurationSec),
        bars: round(wallDurationSec / barDurationSec, 2),
        incomingPlaybackRate: round(tempo.targetPlaybackRate),
        tempo,
        harmonic,
        segment,
        score,
        reasons: reasonsFor(segment, harmonic, tempo),
      });
    }
  }

  return candidates
    .sort((left, right) =>
      right.score - left.score ||
      right.segment.cueQuality - left.segment.cueQuality ||
      right.segment.confidence - left.segment.confidence ||
      left.incoming.startSec - right.incoming.startSec ||
      right.outgoing.startSec - left.outgoing.startSec ||
      left.id.localeCompare(right.id)
    )
    .slice(0, Math.floor(limit));
}

export function rankTransitionCandidates({
  outgoing,
  candidates,
  energyArc,
  limit = 6,
}: {
  outgoing: TrackAnalysis;
  candidates: TrackAnalysis[];
  energyArc: DJPerformancePlan["energyArc"];
  limit?: number;
}): RankedTransitionCandidate[] {
  return candidates
    .filter((candidate) => candidate.sourceTrackId !== outgoing.sourceTrackId)
    .map((analysis) => ({
      analysis,
      suggestions: suggestTransitionWindows({ outgoing, incoming: analysis, energyArc }),
    }))
    .filter((candidate) => candidate.suggestions.length > 0)
    .map((candidate) => ({
      ...candidate,
      score: candidate.suggestions[0].score,
    }))
    .sort((left, right) =>
      right.score - left.score ||
      left.analysis.sourceTrackId.localeCompare(right.analysis.sourceTrackId)
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}
