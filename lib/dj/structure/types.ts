/**
 * Structure Types
 * 
 * Types specific to track structure analysis.
 */

import type { 
  Phrase, 
  Section, 
  StructureMap,
  PhraseType,
  BeatGrid,
  AudioTimeSec,
  Normalized,
  BeatIndex,
} from '../types';

/**
 * Energy change detected in the track
 */
export interface EnergyChange {
  /** Time of the change */
  readonly time: AudioTimeSec;
  /** Beat index at this change */
  readonly beatIndex: BeatIndex;
  /** Type of change */
  readonly type: 'rise' | 'fall' | 'drop' | 'buildup';
  /** Magnitude of change (0-1) */
  readonly magnitude: Normalized;
}

/**
 * Options for structure analysis
 */
export interface StructureAnalysisOptions {
  /** Minimum phrase length in bars (default: 4) */
  readonly minPhraseBars?: number;
  /** Maximum phrase length in bars (default: 32) */
  readonly maxPhraseBars?: number;
  /** Energy change threshold (default: 0.2) */
  readonly energyChangeThreshold?: Normalized;
  /** Whether to merge short similar phrases */
  readonly mergeShortPhrases?: boolean;
}

/**
 * Result of phrase boundary detection
 */
export interface PhraseBoundary {
  /** Time of the boundary */
  readonly time: AudioTimeSec;
  /** Beat index at this boundary */
  readonly beatIndex: BeatIndex;
  /** Confidence this is a real boundary (0-1) */
  readonly confidence: Normalized;
  /** Reason for boundary detection */
  readonly reason: 'energy' | 'silence' | 'pattern' | 'forced';
}

// Re-export from main types
export type { 
  Phrase, 
  Section, 
  StructureMap,
  PhraseType,
  BeatGrid,
  AudioTimeSec,
};
