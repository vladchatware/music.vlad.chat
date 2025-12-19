/**
 * EQ Types
 * 
 * Types specific to EQ control and mix automation.
 */

import type { 
  EQBand, 
  EQKeyframe, 
  EQCurve,
  Normalized,
  DurationSec,
} from '../types';

/**
 * EQ frequency bands (in Hz)
 */
export interface EQFrequencyBands {
  /** Low band: 20-250 Hz */
  readonly low: { min: number; max: number };
  /** Mid band: 250-4000 Hz */
  readonly mid: { min: number; max: number };
  /** High band: 4000-20000 Hz */
  readonly high: { min: number; max: number };
}

/**
 * Default frequency bands
 */
export const DEFAULT_FREQUENCY_BANDS: EQFrequencyBands = {
  low: { min: 20, max: 250 },
  mid: { min: 250, max: 4000 },
  high: { min: 4000, max: 20000 },
};

/**
 * EQ curve preset names
 */
export type EQCurvePreset = 
  | 'bassSwap'          // Kill outgoing bass, bring in incoming bass at midpoint
  | 'frequencySplit'    // Complementary EQ (no overlap in bass)
  | 'smooth'            // Gradual crossfade on all bands
  | 'highFirst'         // Bring in highs, then mids, then bass
  | 'custom';

/**
 * Options for creating EQ curves
 */
export interface EQCurveOptions {
  /** Duration of the transition in seconds */
  readonly durationSec: DurationSec;
  /** When to swap the bass (0-1, default: 0.5) */
  readonly bassSwapPoint?: Normalized;
  /** How quickly to transition each band (0-1, higher = faster) */
  readonly bandTransitionSpeed?: Normalized;
  /** Minimum EQ level (to avoid complete silence) */
  readonly minLevel?: Normalized;
}

/**
 * WebAudio nodes for a 3-band EQ
 */
export interface EQNodes {
  /** Low shelf/band filter */
  readonly lowFilter: BiquadFilterNode;
  /** Mid band filter */
  readonly midFilter: BiquadFilterNode;
  /** High shelf/band filter */
  readonly highFilter: BiquadFilterNode;
  /** Output gain node */
  readonly output: GainNode;
}

// Re-export from main types
export type { 
  EQBand, 
  EQKeyframe, 
  EQCurve,
  Normalized,
  DurationSec,
};
