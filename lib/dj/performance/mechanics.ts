export interface TransitionMechanicsInput {
  requestedExitSec: number;
  requestedEntrySec: number;
  requestedBlendDurationSec: number;
  targetPlaybackRate: number;
  maxAdjustmentPercent?: number;
  minimumExitSec: number;
  outgoingDurationSec: number;
  incomingDurationSec: number;
  minimumIncomingRunwaySec: number;
}

export interface NormalizedTransitionMechanics {
  exitSec: number;
  entrySec: number;
  blendDurationSec: number;
  playbackRate: number;
  adjustments: string[];
}

export function normalizeTransitionMechanics(
  input: TransitionMechanicsInput,
): NormalizedTransitionMechanics {
  const maximumRateDelta = Math.max(0, Math.min(8, input.maxAdjustmentPercent ?? 8)) / 100;
  const playbackRate = Math.max(
    1 - maximumRateDelta,
    Math.min(1 + maximumRateDelta, input.targetPlaybackRate),
  );
  const latestRunwaySafeEntrySec = Math.max(
    0,
    input.incomingDurationSec - input.minimumIncomingRunwaySec * playbackRate,
  );
  const entrySec = Math.max(
    0,
    Math.min(input.requestedEntrySec, input.incomingDurationSec - 0.1, latestRunwaySafeEntrySec),
  );
  const adjustments: string[] = [];
  if (playbackRate !== input.targetPlaybackRate) adjustments.push("tempo_clamped");
  if (entrySec !== input.requestedEntrySec) {
    adjustments.push("entry_clamped_for_continuity_runway");
  }
  const maximumBlendDurationSec = Math.max(
    0.1,
    Math.min(
      32,
      input.outgoingDurationSec - input.minimumExitSec,
      input.incomingDurationSec - entrySec,
    ),
  );
  const blendDurationSec = Math.max(
    0.1,
    Math.min(input.requestedBlendDurationSec, maximumBlendDurationSec),
  );
  if (blendDurationSec !== input.requestedBlendDurationSec) {
    adjustments.push("blend_clamped_to_runway");
  }
  const latestBlendSafeExitSec = Math.max(
    input.minimumExitSec,
    input.outgoingDurationSec - blendDurationSec,
  );
  const exitSec = Math.max(
    input.minimumExitSec,
    Math.min(input.requestedExitSec, latestBlendSafeExitSec),
  );
  if (exitSec !== input.requestedExitSec) adjustments.push("exit_clamped_to_runway");
  return {
    exitSec,
    entrySec,
    blendDurationSec,
    playbackRate,
    adjustments,
  };
}
