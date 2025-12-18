/**
 * EQ Curve Presets
 * 
 * Factory functions for creating EQ automation curves for transitions.
 */

import type { EQBand, EQKeyframe, EQCurve, Normalized } from '../types';
import type { EQCurveOptions } from './types';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASS_SWAP_POINT = 0.5;
const DEFAULT_MIN_LEVEL = 0;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create an EQBand with all values set to the same level.
 */
function uniformBand(level: Normalized): EQBand {
  return { low: level, mid: level, high: level };
}

/**
 * Linear interpolation between two values.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Ease-in-out function for smooth transitions.
 */
function easeInOut(t: number): number {
  return t < 0.5
    ? 2 * t * t
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Interpolate between two EQ bands.
 */
function interpolateBands(a: EQBand, b: EQBand, t: number): EQBand {
  const easedT = easeInOut(t);
  return {
    low: lerp(a.low, b.low, easedT),
    mid: lerp(a.mid, b.mid, easedT),
    high: lerp(a.high, b.high, easedT),
  };
}

/**
 * Get EQ values at a specific progress point from keyframes.
 */
export function getEQAtProgress(keyframes: readonly EQKeyframe[], progress: Normalized): EQBand {
  if (keyframes.length === 0) {
    return uniformBand(1);
  }
  
  if (keyframes.length === 1) {
    return keyframes[0].bands;
  }
  
  // Find surrounding keyframes
  let prevIdx = 0;
  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].time <= progress) {
      prevIdx = i;
    } else {
      break;
    }
  }
  
  const prev = keyframes[prevIdx];
  const next = keyframes[Math.min(prevIdx + 1, keyframes.length - 1)];
  
  if (prev === next) {
    return prev.bands;
  }
  
  // Guard against division by zero when keyframes have identical times
  const dt = next.time - prev.time;
  if (dt === 0) {
    return prev.bands;
  }
  
  // Interpolate between keyframes
  const segmentProgress = (progress - prev.time) / dt;
  return interpolateBands(prev.bands, next.bands, Math.max(0, Math.min(1, segmentProgress)));
}

// =============================================================================
// Curve Presets
// =============================================================================

/**
 * Create a "bass swap" EQ curve.
 * 
 * This is the classic DJ technique:
 * - Outgoing: Gradually cut bass, then mids, then highs
 * - Incoming: Start with highs, bring in mids, then bass (inverted)
 * 
 * Bass is never playing from both tracks simultaneously.
 */
export function createBassSwapCurve(options: EQCurveOptions): EQCurve {
  const {
    durationSec,
    bassSwapPoint = DEFAULT_BASS_SWAP_POINT,
    minLevel = DEFAULT_MIN_LEVEL,
  } = options;
  
  const midPoint = bassSwapPoint;
  
  // Outgoing track: start at full, end at zero
  const outgoing: EQKeyframe[] = [
    { time: 0, bands: { low: 1, mid: 1, high: 1 } },
    { time: midPoint * 0.5, bands: { low: 1, mid: 1, high: 0.8 } },
    { time: midPoint, bands: { low: minLevel, mid: 0.7, high: 0.5 } }, // Bass killed at midpoint
    { time: midPoint + (1 - midPoint) * 0.5, bands: { low: minLevel, mid: 0.3, high: 0.2 } },
    { time: 1, bands: { low: minLevel, mid: minLevel, high: minLevel } },
  ];
  
  // Incoming track: start at zero, end at full
  const incoming: EQKeyframe[] = [
    { time: 0, bands: { low: minLevel, mid: minLevel, high: minLevel } },
    { time: midPoint * 0.3, bands: { low: minLevel, mid: 0.2, high: 0.5 } }, // Highs first
    { time: midPoint * 0.7, bands: { low: minLevel, mid: 0.5, high: 0.8 } }, // Then mids
    { time: midPoint, bands: { low: 0.8, mid: 0.7, high: 1 } }, // Bass in at midpoint
    { time: midPoint + (1 - midPoint) * 0.5, bands: { low: 1, mid: 0.9, high: 1 } },
    { time: 1, bands: { low: 1, mid: 1, high: 1 } },
  ];
  
  return { durationSec, outgoing, incoming };
}

/**
 * Create a "frequency split" EQ curve.
 * 
 * Tracks share frequency space: outgoing keeps bass longer while incoming
 * occupies highs and mids, then they swap in the second half.
 */
export function createFrequencySplitCurve(options: EQCurveOptions): EQCurve {
  const {
    durationSec,
    bassSwapPoint = DEFAULT_BASS_SWAP_POINT,
    minLevel = DEFAULT_MIN_LEVEL,
  } = options;
  
  const midPoint = bassSwapPoint;
  
  // Outgoing: Keep bass, gradually lose mids and highs
  const outgoing: EQKeyframe[] = [
    { time: 0, bands: { low: 1, mid: 1, high: 1 } },
    { time: 0.2, bands: { low: 1, mid: 0.8, high: 0.6 } },
    { time: midPoint, bands: { low: 0.9, mid: 0.4, high: 0.2 } },
    { time: midPoint + 0.1, bands: { low: 0.5, mid: 0.2, high: minLevel } }, // Quick bass drop
    { time: 1, bands: { low: minLevel, mid: minLevel, high: minLevel } },
  ];
  
  // Incoming: Start with highs, add mids, then bass after outgoing drops
  const incoming: EQKeyframe[] = [
    { time: 0, bands: { low: minLevel, mid: minLevel, high: 0.3 } },
    { time: 0.2, bands: { low: minLevel, mid: 0.3, high: 0.6 } },
    { time: midPoint, bands: { low: minLevel, mid: 0.7, high: 0.9 } },
    { time: midPoint + 0.1, bands: { low: 0.7, mid: 0.9, high: 1 } }, // Quick bass in
    { time: 1, bands: { low: 1, mid: 1, high: 1 } },
  ];
  
  return { durationSec, outgoing, incoming };
}

/**
 * Create a smooth crossfade curve (all frequencies together).
 * 
 * Simple but less professional sounding.
 */
export function createSmoothCurve(options: EQCurveOptions): EQCurve {
  const { durationSec, minLevel = DEFAULT_MIN_LEVEL } = options;
  
  const outgoing: EQKeyframe[] = [
    { time: 0, bands: uniformBand(1) },
    { time: 0.3, bands: uniformBand(0.8) },
    { time: 0.5, bands: uniformBand(0.5) },
    { time: 0.7, bands: uniformBand(0.2) },
    { time: 1, bands: uniformBand(minLevel) },
  ];
  
  const incoming: EQKeyframe[] = [
    { time: 0, bands: uniformBand(minLevel) },
    { time: 0.3, bands: uniformBand(0.2) },
    { time: 0.5, bands: uniformBand(0.5) },
    { time: 0.7, bands: uniformBand(0.8) },
    { time: 1, bands: uniformBand(1) },
  ];
  
  return { durationSec, outgoing, incoming };
}

/**
 * Create a "high first" curve.
 * 
 * Incoming track's highs come in first, then mids, then bass.
 * Good for building energy.
 */
export function createHighFirstCurve(options: EQCurveOptions): EQCurve {
  const { durationSec, minLevel = DEFAULT_MIN_LEVEL } = options;
  
  const outgoing: EQKeyframe[] = [
    { time: 0, bands: { low: 1, mid: 1, high: 1 } },
    { time: 0.25, bands: { low: 1, mid: 1, high: 0.5 } },
    { time: 0.5, bands: { low: 1, mid: 0.5, high: 0.2 } },
    { time: 0.75, bands: { low: 0.5, mid: 0.2, high: minLevel } },
    { time: 1, bands: { low: minLevel, mid: minLevel, high: minLevel } },
  ];
  
  const incoming: EQKeyframe[] = [
    { time: 0, bands: { low: minLevel, mid: minLevel, high: 0.3 } },
    { time: 0.25, bands: { low: minLevel, mid: 0.3, high: 0.7 } },
    { time: 0.5, bands: { low: 0.3, mid: 0.7, high: 1 } },
    { time: 0.75, bands: { low: 0.7, mid: 1, high: 1 } },
    { time: 1, bands: { low: 1, mid: 1, high: 1 } },
  ];
  
  return { durationSec, outgoing, incoming };
}

/**
 * Get a curve by preset name.
 */
export function getCurveByPreset(
  preset: 'bassSwap' | 'frequencySplit' | 'smooth' | 'highFirst',
  options: EQCurveOptions
): EQCurve {
  switch (preset) {
    case 'bassSwap':
      return createBassSwapCurve(options);
    case 'frequencySplit':
      return createFrequencySplitCurve(options);
    case 'smooth':
      return createSmoothCurve(options);
    case 'highFirst':
      return createHighFirstCurve(options);
  }
}
