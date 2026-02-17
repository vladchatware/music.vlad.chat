export const MIN_AUTO_CUE_PLAY_SEC = 90;
export const MIN_AUTO_CUE_PROGRESS = 0.7;
export const MIN_AUTO_CUE_REMAINING_SEC = 25;
export const SHORT_TRACK_CLASSIFIER_SEC = 70;
export const SHORT_TRACK_MIN_HOLD_SEC = 16;
export const SHORT_TRACK_MIN_PROGRESS = 0.58;
export const SHORT_TRACK_MIN_REMAINING_SEC = 12;
export const DEFAULT_ABRUPT_MISMATCH_THRESHOLD = 0.35;
export const PLANNED_TRANSITION_TIMEOUT_MS = 12000;
export const MAX_PLANNED_REPLANS = 2;
export const DEFAULT_HOLD_LOOP_WINDOW_SEC = 12;
export const MIN_HOLD_LOOP_WINDOW_SEC = 6;
export const MAX_HOLD_LOOP_WINDOW_SEC = 24;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function computeCrossfadeProgressByClock(opts: {
  startedAtMs: number | null;
  nowMs: number;
  durationSec: number;
}): number {
  const { startedAtMs, nowMs, durationSec } = opts;
  if (startedAtMs === null) return 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 1;
  const elapsed = nowMs - startedAtMs;
  return clamp01(elapsed / (durationSec * 1000));
}

export function shouldTriggerAutoCue(opts: {
  currentTimeSec: number;
  durationSec?: number;
  progress01: number;
  alreadyTriggered: boolean;
  isPlayingState: boolean;
  minPlaySec?: number;
  minProgress?: number;
  minRemainingSec?: number;
  shortTrackMinHoldSec?: number;
  shortTrackMinProgress?: number;
  shortTrackMinRemainingSec?: number;
}): boolean {
  const minPlaySec = opts.minPlaySec ?? MIN_AUTO_CUE_PLAY_SEC;
  const minProgress = opts.minProgress ?? MIN_AUTO_CUE_PROGRESS;
  const minRemainingSec = opts.minRemainingSec ?? MIN_AUTO_CUE_REMAINING_SEC;
  const shortTrackMinHoldSec = opts.shortTrackMinHoldSec ?? SHORT_TRACK_MIN_HOLD_SEC;
  const shortTrackMinProgress = opts.shortTrackMinProgress ?? SHORT_TRACK_MIN_PROGRESS;
  const shortTrackMinRemainingSec =
    opts.shortTrackMinRemainingSec ?? SHORT_TRACK_MIN_REMAINING_SEC;
  if (!opts.isPlayingState) return false;
  if (opts.alreadyTriggered) return false;

  const durationSec =
    Number.isFinite(opts.durationSec) && (opts.durationSec as number) > 0
      ? (opts.durationSec as number)
      : null;
  const remainingSec = durationSec !== null ? durationSec - opts.currentTimeSec : null;

  // Short effective streams (e.g. 30s previews) should breathe longer before queueing.
  // Keep this classifier independent of long-track hold constants to avoid accidental early cueing.
  if (durationSec !== null && durationSec <= SHORT_TRACK_CLASSIFIER_SEC) {
    return (
      opts.currentTimeSec >= shortTrackMinHoldSec &&
      opts.progress01 >= shortTrackMinProgress &&
      remainingSec !== null &&
      remainingSec <= shortTrackMinRemainingSec
    );
  }

  const byHoldAndProgress = opts.currentTimeSec >= minPlaySec && opts.progress01 >= minProgress;
  if (byHoldAndProgress) return true;

  if (remainingSec !== null) {
    if (remainingSec <= minRemainingSec) return true;
  }

  return false;
}

export type HoldLoopPlan = {
  loopStartSec: number;
  windowSec: number;
  barDurationSec: number | null;
  bars: number | null;
  bpm: number | null;
};

export function computePhraseQuantizedHoldLoop(opts: {
  durationSec: number;
  bpm?: number | null;
  fallbackWindowSec?: number;
  minWindowSec?: number;
  maxWindowSec?: number;
}): HoldLoopPlan {
  const durationSec =
    Number.isFinite(opts.durationSec) && opts.durationSec > 0 ? opts.durationSec : 0;
  if (durationSec <= 0) {
    return {
      loopStartSec: 0,
      windowSec: 0,
      barDurationSec: null,
      bars: null,
      bpm: null,
    };
  }

  const fallbackWindowSec = opts.fallbackWindowSec ?? DEFAULT_HOLD_LOOP_WINDOW_SEC;
  const minWindowSec = opts.minWindowSec ?? MIN_HOLD_LOOP_WINDOW_SEC;
  const maxWindowSec = opts.maxWindowSec ?? MAX_HOLD_LOOP_WINDOW_SEC;
  const dynamicMaxWindowSec = Math.max(
    minWindowSec,
    Math.min(maxWindowSec, durationSec * 0.8, Math.max(minWindowSec, durationSec - 1)),
  );
  const latestLoopStartSec = Math.max(0, durationSec - minWindowSec);

  const bpm =
    Number.isFinite(opts.bpm) && (opts.bpm as number) >= 40 && (opts.bpm as number) <= 240
      ? (opts.bpm as number)
      : null;

  if (bpm === null) {
    const windowSec = Math.max(minWindowSec, Math.min(fallbackWindowSec, dynamicMaxWindowSec));
    const loopStartSec = Math.max(0, Math.min(durationSec - windowSec, latestLoopStartSec));
    return {
      loopStartSec,
      windowSec: durationSec - loopStartSec,
      barDurationSec: null,
      bars: null,
      bpm: null,
    };
  }

  const barDurationSec = (60 / bpm) * 4;
  const candidateBars = [8, 4, 2];
  let bars = candidateBars.find((candidate) => {
    const win = barDurationSec * candidate;
    return win <= dynamicMaxWindowSec + 0.001 && durationSec - win >= 1;
  });
  if (!bars) bars = 2;

  const plannedWindowSec = Math.max(
    minWindowSec,
    Math.min(barDurationSec * bars, dynamicMaxWindowSec),
  );
  const rawLoopStartSec = Math.max(0, durationSec - plannedWindowSec);
  let loopStartSec =
    Math.floor((rawLoopStartSec + 1e-6) / barDurationSec) * barDurationSec;
  if (durationSec - loopStartSec > dynamicMaxWindowSec + barDurationSec * 0.5) {
    loopStartSec += barDurationSec;
  }
  loopStartSec = Math.max(0, Math.min(loopStartSec, latestLoopStartSec));

  const windowSec = durationSec - loopStartSec;
  const effectiveBars = Math.max(1, Math.round(windowSec / barDurationSec));

  return {
    loopStartSec,
    windowSec,
    barDurationSec,
    bars: effectiveBars,
    bpm,
  };
}

export function computeHandoffEnergyMismatch(opts: {
  outgoingEnergy: number;
  incomingEnergy: number;
}): number {
  const out = clamp01(opts.outgoingEnergy);
  const inn = clamp01(opts.incomingEnergy);
  return clamp01(Math.abs(out - inn));
}

export function isAbruptTransition(opts: {
  mismatch: number;
  threshold?: number;
}): boolean {
  const threshold = opts.threshold ?? DEFAULT_ABRUPT_MISMATCH_THRESHOLD;
  return clamp01(opts.mismatch) >= clamp01(threshold);
}

export function evaluatePlannedTimeout(opts: {
  plannedAtMs: number | null;
  nowMs: number;
  replanCount: number;
  timeoutMs?: number;
  maxReplans?: number;
}): "none" | "replan" | "abort" {
  const timeoutMs = opts.timeoutMs ?? PLANNED_TRANSITION_TIMEOUT_MS;
  const maxReplans = opts.maxReplans ?? MAX_PLANNED_REPLANS;
  if (opts.plannedAtMs === null) return "none";
  if (opts.nowMs - opts.plannedAtMs <= timeoutMs) return "none";
  return opts.replanCount < maxReplans ? "replan" : "abort";
}
