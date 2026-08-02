import type { DJPerformancePlan } from "../../lib/dj";

export interface BenchTimelineTrack {
  id: number;
  title: string;
  artist?: string;
  bpm?: number;
  durationSec: number;
  genre?: string;
}

export interface BenchAudibleSegment {
  id: string;
  trackId: number;
  title: string;
  artist?: string;
  setStartSec: number;
  setEndSec: number;
  sourceStartSec: number;
  sourceEndSec: number;
  playbackRate: number;
}

export interface BenchTimelineTransition {
  id: string;
  fromTrackId: number;
  toTrackId: number;
  acceptedAtSetSec: number;
  setStartSec: number;
  setEndSec: number;
  outgoingStartSec: number;
  incomingStartSec: number;
  incomingPlaybackRate: number;
  blendDurationSec: number;
  performance: DJPerformancePlan;
}

export interface BenchTimelineEvent {
  id: string;
  sequence: number;
  type: string;
  setTimeSec: number;
  wallTime: string;
  wallElapsedMs: number;
  turn?: number;
  step?: number;
  text?: string;
  reasoningText?: string;
  payload: Record<string, unknown>;
}

export interface BenchTimelineManifest {
  schemaVersion: 1;
  runId: string;
  model: string;
  provider: string;
  scenario: string;
  prompt: string;
  startedAt: string;
  finishedAt: string;
  targetDurationSec: number;
  achievedDurationSec: number;
  tracks: BenchTimelineTrack[];
  audibleSegments: BenchAudibleSegment[];
  transitions: BenchTimelineTransition[];
  events: BenchTimelineEvent[];
}

export function segmentSourceTime(segment: BenchAudibleSegment, setTimeSec: number): number {
  const elapsed = Math.max(0, setTimeSec - segment.setStartSec);
  return Math.min(segment.sourceEndSec, segment.sourceStartSec + elapsed * segment.playbackRate);
}

export function audibleSegmentsAt(
  segments: BenchAudibleSegment[],
  setTimeSec: number,
): BenchAudibleSegment[] {
  return segments.filter(
    (segment) => setTimeSec >= segment.setStartSec && setTimeSec < segment.setEndSec,
  );
}

export function analyzeAudibleCoverage(
  segments: BenchAudibleSegment[],
  targetDurationSec: number,
): { continuousThroughSec: number; coveredDurationSec: number; maxGapSec: number } {
  const target = Math.max(0, targetDurationSec);
  const intervals = segments
    .map((segment) => ({
      start: Math.max(0, Math.min(target, segment.setStartSec)),
      end: Math.max(0, Math.min(target, segment.setEndSec)),
    }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = 0;
  let continuousThroughSec = 0;
  let coveredDurationSec = 0;
  let maxGapSec = 0;
  let continuous = true;
  for (const interval of intervals) {
    if (interval.start > cursor) {
      maxGapSec = Math.max(maxGapSec, interval.start - cursor);
      continuous = false;
    }
    const uncoveredStart = Math.max(cursor, interval.start);
    coveredDurationSec += Math.max(0, interval.end - uncoveredStart);
    if (continuous && interval.start <= cursor) continuousThroughSec = Math.max(continuousThroughSec, interval.end);
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < target) maxGapSec = Math.max(maxGapSec, target - cursor);
  return { continuousThroughSec, coveredDurationSec, maxGapSec };
}
