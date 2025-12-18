/**
 * Harmonic Types
 * 
 * Types specific to harmonic/key analysis and matching.
 */

import type { CamelotKey, HarmonicRelationship, HarmonicScore } from '../types';

/**
 * Musical key in standard notation
 */
export type MusicalKey =
  | 'C' | 'C#' | 'Db' | 'D' | 'D#' | 'Eb' | 'E' | 'F' | 'F#' | 'Gb' | 'G' | 'G#' | 'Ab' | 'A' | 'A#' | 'Bb' | 'B'
  | 'Cm' | 'C#m' | 'Dbm' | 'Dm' | 'D#m' | 'Ebm' | 'Em' | 'Fm' | 'F#m' | 'Gbm' | 'Gm' | 'G#m' | 'Abm' | 'Am' | 'A#m' | 'Bbm' | 'Bm';

/**
 * Key mode (major or minor)
 */
export type KeyMode = 'major' | 'minor';

/**
 * Parsed key information
 */
export interface ParsedKey {
  /** Root note (0-11, where 0 = C) */
  readonly root: number;
  /** Key mode */
  readonly mode: KeyMode;
  /** Camelot notation */
  readonly camelot: CamelotKey;
  /** Original string representation */
  readonly original: string;
}

/**
 * Compatibility result with details
 */
export interface CompatibilityResult extends HarmonicScore {
  /** Source key */
  readonly sourceKey: CamelotKey;
  /** Target key */
  readonly targetKey: CamelotKey;
  /** Distance on the Camelot wheel (0-6) */
  readonly wheelDistance: number;
}

// Re-export from main types for convenience
export type { CamelotKey, HarmonicRelationship, HarmonicScore };
