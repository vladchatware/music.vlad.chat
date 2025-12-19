/**
 * Energy Types
 * 
 * Types specific to energy analysis and transition scoring.
 */

import type { 
  EnergyCurve, 
  TransitionScore,
  AudioTimeSec,
  DurationSec,
  Normalized,
} from '../types';

/**
 * Energy band analysis (frequency-based)
 */
export interface EnergyBands {
  /** Low frequency energy (20-250 Hz) */
  readonly bass: Normalized;
  /** Mid frequency energy (250-4000 Hz) */
  readonly mid: Normalized;
  /** High frequency energy (4000-20000 Hz) */
  readonly high: Normalized;
  /** Overall energy */
  readonly overall: Normalized;
}

/**
 * Energy momentum (rate of change)
 */
export interface EnergyMomentum {
  /** Current rate of change (positive = rising, negative = falling) */
  readonly slope: number;
  /** Direction of energy change */
  readonly direction: 'rising' | 'falling' | 'stable';
  /** Magnitude of change (0-1) */
  readonly magnitude: Normalized;
}

/**
 * Options for energy analysis
 */
export interface EnergyAnalysisOptions {
  /** Sample rate for the output curve (samples per second) */
  readonly outputSampleRate?: number;
  /** Window size for averaging in seconds */
  readonly windowSec?: DurationSec;
  /** Smoothing factor (0-1, higher = smoother) */
  readonly smoothing?: Normalized;
}

/**
 * Options for transition scoring
 */
export interface TransitionScoringOptions {
  /** Weight for energy match (default: 0.4) */
  readonly energyMatchWeight?: Normalized;
  /** Weight for momentum match (default: 0.3) */
  readonly momentumMatchWeight?: Normalized;
  /** Weight for contrast score (default: 0.3) */
  readonly contrastWeight?: Normalized;
}

/**
 * Transition candidate with score
 */
export interface TransitionCandidate {
  /** Exit point in the outgoing track */
  readonly exitTime: AudioTimeSec;
  /** Entry point in the incoming track */
  readonly entryTime: AudioTimeSec;
  /** Transition score */
  readonly score: TransitionScore;
}

// Re-export from main types
export type { 
  EnergyCurve, 
  TransitionScore,
  AudioTimeSec,
  DurationSec,
  Normalized,
};
