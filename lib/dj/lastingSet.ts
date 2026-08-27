export const MIN_BODY_TRACK_DURATION_SEC = 120;
export const MAX_BODY_TRACK_DURATION_SEC = 10 * 60;
export const MIN_TRACK_DWELL_SEC = 75;
export const MIN_FUTURE_TRACK_RUNWAY_SEC = 95;

export interface AudibleDwellState {
  trackId: number;
  audibleSec: number;
  lastSourceSec: number;
}

export function advanceAudibleDwell(
  state: AudibleDwellState | null,
  input: {
    trackId: number;
    sourceSec: number;
    playbackRate: number;
    playing: boolean;
  },
): AudibleDwellState {
  if (!state || state.trackId !== input.trackId) {
    return { trackId: input.trackId, audibleSec: 0, lastSourceSec: input.sourceSec };
  }
  const sourceDeltaSec = input.sourceSec - state.lastSourceSec;
  return {
    ...state,
    lastSourceSec: input.sourceSec,
    audibleSec: state.audibleSec + (
      input.playing && sourceDeltaSec > 0
        ? sourceDeltaSec / Math.max(0.01, input.playbackRate)
        : 0
    ),
  };
}

export function normalizeTrackDurationSec(
  duration: number | null | undefined,
  unit: "sec" | "ms",
): number | null {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return unit === "ms" ? duration / 1_000 : duration;
}

export function isLastingBodyTrack(
  duration: number | null | undefined,
  unit: "sec" | "ms",
): boolean {
  const durationSec = normalizeTrackDurationSec(duration, unit);
  return durationSec !== null &&
    durationSec >= MIN_BODY_TRACK_DURATION_SEC &&
    durationSec <= MAX_BODY_TRACK_DURATION_SEC;
}

export function minimumDwellExitSec(input: {
  currentSourceSec: number;
  audibleSec: number;
  playbackRate?: number;
}): number {
  const remainingDwellSec = Math.max(0, MIN_TRACK_DWELL_SEC - input.audibleSec);
  return input.currentSourceSec + remainingDwellSec * (input.playbackRate ?? 1);
}
