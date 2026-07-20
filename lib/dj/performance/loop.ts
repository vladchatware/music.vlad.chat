import type { PerformanceLoop } from "./types";

export function evaluatePerformanceLoop(
  loop: PerformanceLoop,
  currentTimeSec: number,
  completedRepetitions: number,
): {
  shouldSeek: boolean;
  seekToSec: number | null;
  completedRepetitions: number;
  done: boolean;
} {
  if (completedRepetitions >= loop.repetitions) {
    return {
      shouldSeek: false,
      seekToSec: null,
      completedRepetitions,
      done: true,
    };
  }
  if (currentTimeSec < loop.endSec - 0.25) {
    return {
      shouldSeek: false,
      seekToSec: null,
      completedRepetitions,
      done: false,
    };
  }
  return {
    shouldSeek: true,
    seekToSec: loop.startSec,
    completedRepetitions: completedRepetitions + 1,
    done: false,
  };
}
