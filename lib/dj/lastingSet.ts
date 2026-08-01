export const MIN_BODY_TRACK_DURATION_SEC = 120;
export const MIN_TRACK_DWELL_SEC = 75;
export const MIN_FUTURE_TRACK_RUNWAY_SEC = 95;

export function normalizeTrackDurationSec(duration: number | null | undefined): number | null {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return duration > 10_000 ? duration / 1_000 : duration;
}

export function isLastingBodyTrack(duration: number | null | undefined): boolean {
  const durationSec = normalizeTrackDurationSec(duration);
  return durationSec !== null && durationSec >= MIN_BODY_TRACK_DURATION_SEC;
}

export function minimumDwellExitSec(input: {
  currentSourceSec: number;
  audibleSec: number;
  playbackRate?: number;
}): number {
  const remainingDwellSec = Math.max(0, MIN_TRACK_DWELL_SEC - input.audibleSec);
  return input.currentSourceSec + remainingDwellSec * (input.playbackRate ?? 1);
}
