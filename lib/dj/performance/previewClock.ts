export type TransitionClockInput = {
  outgoingStartSec: number;
  incomingStartSec: number;
  incomingPlaybackRate: number;
  durationSec: number;
  elapsedSec: number;
};

export type TransitionClockPosition = {
  progress: number;
  outgoingSec: number;
  incomingSec: number;
};

/** Projects both deck playheads from the same wall clock. */
export function projectTransitionClock({
  outgoingStartSec,
  incomingStartSec,
  incomingPlaybackRate,
  durationSec,
  elapsedSec,
}: TransitionClockInput): TransitionClockPosition {
  const safeDuration = Math.max(0, durationSec);
  const clampedElapsed = Math.min(safeDuration, Math.max(0, elapsedSec));

  return {
    progress: safeDuration === 0 ? 1 : clampedElapsed / safeDuration,
    outgoingSec: outgoingStartSec + clampedElapsed,
    incomingSec: incomingStartSec + clampedElapsed * incomingPlaybackRate,
  };
}
