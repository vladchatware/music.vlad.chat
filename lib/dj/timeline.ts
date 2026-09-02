import type { DJTimelinePatch, PlayerToolInput } from "./performance/schema";

export const DJ_TIMELINE_TARGET_LOOKAHEAD = 3;
export const DJ_TIMELINE_LOW_WATERMARK = 2;

export type DJTimelineItemStatus = "planned" | "committed";

export type DJTimelineItem = {
  eventId: string;
  status: DJTimelineItemStatus;
  request: PlayerToolInput;
};

export type DJTimelineFailure = {
  trackId: number;
  reason: string;
  atMs: number;
};

export type DJTimelineState = {
  /** Compare-and-swap revision for agent-owned suffix edits. */
  revision: number;
  /** Monotonic mechanical cursor revision; never invalidates an agent edit. */
  playbackRevision: number;
  committed: DJTimelineItem | null;
  planned: DJTimelineItem[];
  lastFailure: DJTimelineFailure | null;
};

export type DJTimelineSnapshot = DJTimelineState & {
  targetLookahead: number;
  lowWatermark: number;
  plannedTrackIds: number[];
  editableAfterEventId: string | null;
};

export type DJTimelinePatchResult =
  | { outcome: "accepted"; snapshot: DJTimelineSnapshot }
  | { outcome: "rejected"; reason: "stale_revision" | "duplicate_track"; snapshot: DJTimelineSnapshot };

type TimelineControllerOptions = {
  generateId?: () => string;
  now?: () => number;
};

export function createDJTimelineController(opts: TimelineControllerOptions = {}) {
  const generateId = opts.generateId ?? (() => crypto.randomUUID());
  const now = opts.now ?? (() => Date.now());
  let state: DJTimelineState = {
    revision: 0,
    playbackRevision: 0,
    committed: null,
    planned: [],
    lastFailure: null,
  };

  const snapshot = (): DJTimelineSnapshot => ({
    revision: state.revision,
    playbackRevision: state.playbackRevision,
    committed: state.committed,
    planned: state.planned,
    lastFailure: state.lastFailure,
    targetLookahead: DJ_TIMELINE_TARGET_LOOKAHEAD,
    lowWatermark: DJ_TIMELINE_LOW_WATERMARK,
    plannedTrackIds: [
      ...(state.committed ? [state.committed.request.id] : []),
      ...state.planned.map((item) => item.request.id),
    ],
    editableAfterEventId: state.committed?.eventId ?? null,
  });

  const replaceSuffix = (patch: DJTimelinePatch): DJTimelinePatchResult => {
    if (patch.baseRevision !== state.revision) {
      return { outcome: "rejected", reason: "stale_revision", snapshot: snapshot() };
    }
    const protectedTrackId = state.committed?.request.id ?? null;
    const ids = patch.tracks.map((track) => track.id);
    if (new Set(ids).size !== ids.length) {
      return { outcome: "rejected", reason: "duplicate_track", snapshot: snapshot() };
    }
    // Agent may have authored while playback promoted old suffix head. Treat
    // current committed track as anchor when it remains first in submitted
    // order, then replace only tracks after it.
    const rebasedTracks = protectedTrackId !== null && patch.tracks[0]?.id === protectedTrackId
      ? patch.tracks.slice(1)
      : patch.tracks;
    if (protectedTrackId !== null && rebasedTracks.some((track) => track.id === protectedTrackId)) {
      return { outcome: "rejected", reason: "duplicate_track", snapshot: snapshot() };
    }
    state = {
      ...state,
      revision: state.revision + 1,
      planned: rebasedTracks.map((request) => ({
        eventId: generateId(),
        status: "planned" as const,
        request,
      })),
      lastFailure: null,
    };
    return { outcome: "accepted", snapshot: snapshot() };
  };

  const commitNext = (): DJTimelineItem | null => {
    if (state.committed || state.planned.length === 0) return state.committed;
    const [next, ...remaining] = state.planned;
    const committed = { ...next!, status: "committed" as const };
    state = {
      ...state,
      playbackRevision: state.playbackRevision + 1,
      committed,
      planned: remaining,
    };
    return committed;
  };

  const completeCommitted = (trackId: number): DJTimelineSnapshot => {
    if (state.committed?.request.id !== trackId) return snapshot();
    state = {
      ...state,
      playbackRevision: state.playbackRevision + 1,
      committed: null,
      lastFailure: null,
    };
    return snapshot();
  };

  const failCommitted = (trackId: number, reason: string): DJTimelineSnapshot => {
    if (state.committed?.request.id !== trackId) return snapshot();
    state = {
      ...state,
      playbackRevision: state.playbackRevision + 1,
      committed: null,
      lastFailure: { trackId, reason, atMs: now() },
    };
    return snapshot();
  };

  const clearEditableSuffix = (): DJTimelineSnapshot => {
    if (state.planned.length === 0) return snapshot();
    state = {
      ...state,
      revision: state.revision + 1,
      planned: [],
    };
    return snapshot();
  };

  return {
    snapshot,
    replaceSuffix,
    commitNext,
    completeCommitted,
    failCommitted,
    clearEditableSuffix,
  };
}
