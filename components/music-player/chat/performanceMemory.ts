import type { DJPerformancePlan } from "@/lib/dj";

export type PerformanceMemoryTrack = {
  id: number;
  title: string;
  artist: string;
};

export type ConfirmedTransition = {
  from: PerformanceMemoryTrack;
  to: PerformanceMemoryTrack;
  energyArc: DJPerformancePlan["energyArc"];
  reason: string;
  outcome: "queued" | "playing" | "failed";
};

export type PerformanceMemory = {
  intent: string;
  playedTracks: PerformanceMemoryTrack[];
  recentTransitions: Omit<ConfirmedTransition, "outcome">[];
  candidateTrackIds: number[];
};

const MAX_PLAYED_TRACKS = 12;
const MAX_RECENT_TRANSITIONS = 6;
const MAX_CANDIDATE_TRACKS = 12;

export function createPerformanceMemory(intent: string): PerformanceMemory {
  return { intent, playedTracks: [], recentTransitions: [], candidateTrackIds: [] };
}

export function appendPlayedTrack(
  memory: PerformanceMemory,
  track: PerformanceMemoryTrack,
): PerformanceMemory {
  const withoutTrack = memory.playedTracks.filter(({ id }) => id !== track.id);
  return {
    ...memory,
    playedTracks: [...withoutTrack, track].slice(-MAX_PLAYED_TRACKS),
    candidateTrackIds: memory.candidateTrackIds.filter((id) => id !== track.id),
  };
}

export function appendScheduledCandidates(
  memory: PerformanceMemory,
  trackIds: number[],
): PerformanceMemory {
  const played = new Set(memory.playedTracks.map(({ id }) => id));
  const candidates = [...memory.candidateTrackIds, ...trackIds].filter(
    (id, index, all) => Number.isInteger(id) && id > 0 && !played.has(id) && all.lastIndexOf(id) === index,
  );
  return { ...memory, candidateTrackIds: candidates.slice(-MAX_CANDIDATE_TRACKS) };
}

export function appendConfirmedTransition(
  memory: PerformanceMemory,
  transition: ConfirmedTransition,
): PerformanceMemory {
  if (transition.outcome === "failed") return memory;
  const { outcome: _outcome, ...confirmed } = transition;
  return {
    ...memory,
    recentTransitions: [...memory.recentTransitions, confirmed].slice(-MAX_RECENT_TRANSITIONS),
  };
}
