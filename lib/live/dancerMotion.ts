import { getBeatAtTime, type BeatGrid } from "@/lib/dj";

export type AudioBeatSnapshot = {
  phase: number;
  strength: number;
  tracked: boolean;
};

export type BeatAmplitudeRange = {
  floor: number;
  ceiling: number;
};

export function updateBeatAmplitude(
  current: BeatAmplitudeRange | null,
  sample: number,
): { range: BeatAmplitudeRange; strength: number } {
  const value = clamp01(sample);
  if (!current) {
    const floor = value * 0.75;
    return {
      range: { floor, ceiling: Math.max(value, floor + 0.12) },
      strength: 1,
    };
  }
  const floor = value < current.floor
    ? value
    : current.floor + (value - current.floor) * 0.002;
  const ceiling = value > current.ceiling
    ? value
    : current.ceiling + (value - current.ceiling) * 0.005;
  return {
    range: { floor, ceiling },
    strength: clamp01((value - floor) / Math.max(0.08, ceiling - floor)),
  };
}

export function getPlaybackBeatSnapshot({
  beatGrid,
  currentTimeSec,
  strength,
  fallbackPhase,
  fallbackTracked,
}: {
  beatGrid: BeatGrid | null;
  currentTimeSec: number;
  strength: number;
  fallbackPhase: number;
  fallbackTracked: boolean;
}): AudioBeatSnapshot {
  const hasAnalyzedMarkers = Boolean(
    beatGrid && beatGrid.confidence >= 0.25 && beatGrid.beats && beatGrid.beats.length >= 2,
  );
  if (beatGrid && hasAnalyzedMarkers) {
    return {
      phase: getBeatAtTime(beatGrid, currentTimeSec).phase,
      strength: clamp01(strength),
      tracked: true,
    };
  }
  return {
    phase: clamp01(fallbackPhase),
    strength: clamp01(strength),
    tracked: fallbackTracked,
  };
}

const LANES = [0, -0.85, 0.85, -1.7, 1.7] as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function crowdPlacement(index: number, seed: number) {
  const lane = index % LANES.length;
  const row = Math.floor(index / LANES.length);
  const staggeredX = row % 2 === 0
    ? LANES[lane]
    : LANES[lane] * 0.86 + 0.28;
  const jitter = (((seed >> 8) % 20) - 10) * 0.008;

  return {
    x: staggeredX + jitter,
    y: -3.5,
    z: row * -1.2,
  };
}

export function getBeatPulse(snapshot: AudioBeatSnapshot): number {
  const strength = clamp01(snapshot.strength);
  if (!snapshot.tracked) return strength ** 1.5;
  const phase = clamp01(snapshot.phase);
  const energyGate = clamp01((strength - 0.2) / 0.6);
  const shapedEnergy = energyGate * energyGate * (3 - 2 * energyGate);
  return clamp01(Math.exp(-phase * 4) * shapedEnergy);
}

export function nextDancerY(currentY: number, targetY: number, deltaSec: number): number {
  if (targetY >= currentY) return targetY;
  return currentY + (targetY - currentY) * (1 - Math.exp(-18 * deltaSec));
}

export function getDancerJumpAmplitude(
  strength: number,
  jumpRequested: boolean,
  commentCount: number,
): number {
  const base = 0.32 + clamp01(strength) * 1.05 + Math.min(commentCount, 8) * 0.02;
  return jumpRequested ? base * 1.35 : base;
}

export function nextSimulatorUsername(username: string): string {
  const match = username.match(/^(.*?)(\d+)$/);
  if (!match) return `${username}2`;
  return `${match[1]}${Number(match[2]) + 1}`;
}
