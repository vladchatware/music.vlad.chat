/**
 * Tempo Types
 * 
 * Types specific to tempo analysis and beat matching.
 */

import type { 
  BPM, 
  BeatGrid, 
  TempoConstraints, 
  TempoMatchResult,
  AudioTimeSec,
  DurationMs,
  BeatIndex,
  BarIndex,
  BeatPhase,
  Normalized,
  PlaybackRate,
} from '../types';

/**
 * Beat detection result from audio analysis
 */
export interface BeatDetection {
  /** Detected BPM */
  readonly bpm: BPM;
  /** Confidence in the detection (0-1) */
  readonly confidence: Normalized;
  /** Detected beat timestamps */
  readonly beats: readonly AudioTimeSec[];
  /** First downbeat (start of a bar) */
  readonly firstDownbeat: AudioTimeSec;
}

/**
 * Phase alignment result
 */
export interface PhaseAlignment {
  /** Time offset to apply to align phases (in ms) */
  readonly offsetMs: DurationMs;
  /** Quality of alignment (0-1) */
  readonly quality: Normalized;
  /** Phase difference before alignment (0-1) */
  readonly phaseDifference: BeatPhase;
}

/**
 * Options for beat grid construction
 */
export interface BeatGridOptions {
  /** Fallback BPM if detection fails */
  readonly fallbackBpm?: BPM;
  /** Minimum confidence to trust detected BPM */
  readonly minConfidence?: Normalized;
  /** Whether to snap to common BPM values (120, 125, 128, etc.) */
  readonly snapToCommon?: boolean;
}

/**
 * Result of locating a position within a beat grid
 */
export interface GridPosition {
  /** Current beat index (0-based) */
  readonly beatIndex: BeatIndex;
  /** Current bar index (0-based) */
  readonly barIndex: BarIndex;
  /** Phase within current beat (0-1) */
  readonly beatPhase: BeatPhase;
  /** Phase within current bar (0-1) */
  readonly barPhase: Normalized;
  /** Time since last beat (ms) */
  readonly timeSinceLastBeat: DurationMs;
  /** Time to next beat (ms) */
  readonly timeToNextBeat: DurationMs;
}

// Re-export from main types
export type { 
  BPM, 
  BeatGrid, 
  TempoConstraints, 
  TempoMatchResult,
  AudioTimeSec,
  PlaybackRate,
};
