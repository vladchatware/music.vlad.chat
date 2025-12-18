/**
 * Camelot Wheel Implementation
 * 
 * The Camelot wheel is a tool for harmonic mixing in DJing.
 * Keys are arranged in a circle where adjacent keys are harmonically compatible.
 * 
 * The wheel has two rings:
 * - Inner ring (A): Minor keys (1A-12A)
 * - Outer ring (B): Major keys (1B-12B)
 * 
 * Compatible mixing rules:
 * - Same key: Perfect match
 * - +/- 1 on the wheel: Energy change (raising/lowering)
 * - Same number, different letter: Relative major/minor switch
 * - +/- 7 on the wheel: Perfect 5th relationship
 */

import type { CamelotKey, HarmonicRelationship, HarmonicScore, Normalized } from '../types';
import type { ParsedKey, CompatibilityResult, KeyMode } from './types';

// =============================================================================
// Constants
// =============================================================================

/**
 * Mapping from standard key notation to Camelot notation.
 * Major keys map to B, minor keys map to A.
 */
const KEY_TO_CAMELOT: Record<string, CamelotKey> = {
  // Major keys (B ring)
  'C': '8B', 'Cmaj': '8B',
  'G': '9B', 'Gmaj': '9B',
  'D': '10B', 'Dmaj': '10B',
  'A': '11B', 'Amaj': '11B',
  'E': '12B', 'Emaj': '12B',
  'B': '1B', 'Bmaj': '1B',
  'F#': '2B', 'F#maj': '2B', 'Gb': '2B', 'Gbmaj': '2B',
  'C#': '3B', 'C#maj': '3B', 'Db': '3B', 'Dbmaj': '3B',
  'Ab': '4B', 'Abmaj': '4B', 'G#': '4B', 'G#maj': '4B',
  'Eb': '5B', 'Ebmaj': '5B', 'D#': '5B', 'D#maj': '5B',
  'Bb': '6B', 'Bbmaj': '6B', 'A#': '6B', 'A#maj': '6B',
  'F': '7B', 'Fmaj': '7B',
  
  // Minor keys (A ring)
  'Am': '8A', 'Amin': '8A',
  'Em': '9A', 'Emin': '9A',
  'Bm': '10A', 'Bmin': '10A',
  'F#m': '11A', 'F#min': '11A', 'Gbm': '11A', 'Gbmin': '11A',
  'C#m': '12A', 'C#min': '12A', 'Dbm': '12A', 'Dbmin': '12A',
  'G#m': '1A', 'G#min': '1A', 'Abm': '1A', 'Abmin': '1A',
  'D#m': '2A', 'D#min': '2A', 'Ebm': '2A', 'Ebmin': '2A',
  'A#m': '3A', 'A#min': '3A', 'Bbm': '3A', 'Bbmin': '3A',
  'Fm': '4A', 'Fmin': '4A',
  'Cm': '5A', 'Cmin': '5A',
  'Gm': '6A', 'Gmin': '6A',
  'Dm': '7A', 'Dmin': '7A',
};

/**
 * Mapping from Camelot notation to standard key notation
 */
const CAMELOT_TO_KEY: Record<CamelotKey, string> = {
  '1A': 'G#m', '2A': 'D#m', '3A': 'A#m', '4A': 'Fm', '5A': 'Cm', '6A': 'Gm',
  '7A': 'Dm', '8A': 'Am', '9A': 'Em', '10A': 'Bm', '11A': 'F#m', '12A': 'C#m',
  '1B': 'B', '2B': 'F#', '3B': 'C#', '4B': 'Ab', '5B': 'Eb', '6B': 'Bb',
  '7B': 'F', '8B': 'C', '9B': 'G', '10B': 'D', '11B': 'A', '12B': 'E',
};

/**
 * Root note to semitone offset (C = 0)
 */
const ROOT_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
  'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
};

// =============================================================================
// Key Parsing
// =============================================================================

/**
 * Normalize a key string for consistent lookup.
 * Handles various formats: "Am", "A minor", "A min", "Amin", "8A", etc.
 */
function normalizeKeyString(key: string): string {
  // Trim and handle empty
  const trimmed = key.trim();
  if (!trimmed) return '';
  
  // Already in Camelot format?
  if (/^(1[0-2]|[1-9])[AB]$/i.test(trimmed)) {
    return trimmed.toUpperCase() as CamelotKey;
  }
  
  // Normalize common variations
  let normalized = trimmed
    .replace(/\s+/g, '')           // Remove spaces
    .replace(/major/i, 'maj')
    .replace(/minor/i, 'm')
    .replace(/min$/i, 'm')
    .replace(/maj$/i, '');         // Remove trailing 'maj' for major keys
  
  // Handle "A minor" -> "Am" style
  if (/^[A-Ga-g][#b]?m$/i.test(normalized)) {
    // Already in correct format
    normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase().replace('m', 'm');
  } else if (/^[A-Ga-g][#b]?$/i.test(normalized)) {
    // Major key without suffix
    normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  
  return normalized;
}

/**
 * Parse a key signature string into a Camelot key.
 * Returns null if the key cannot be parsed.
 * 
 * @example
 * parseKey("Am") // Returns "8A"
 * parseKey("C major") // Returns "8B"
 * parseKey("8A") // Returns "8A"
 */
export function parseKey(keySignature: string): CamelotKey | null {
  if (!keySignature) return null;
  
  const normalized = normalizeKeyString(keySignature);
  if (!normalized) return null;
  
  // Already in Camelot format?
  if (/^(1[0-2]|[1-9])[AB]$/.test(normalized)) {
    return normalized as CamelotKey;
  }
  
  // Look up in mapping
  const camelot = KEY_TO_CAMELOT[normalized];
  if (camelot) return camelot;
  
  // Try with different case variations
  const upperFirst = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  return KEY_TO_CAMELOT[upperFirst] ?? null;
}

/**
 * Convert a Camelot key back to standard notation.
 */
export function camelotToKey(camelot: CamelotKey): string {
  return CAMELOT_TO_KEY[camelot];
}

/**
 * Parse a key into detailed information.
 */
export function parseKeyDetailed(keySignature: string): ParsedKey | null {
  const camelot = parseKey(keySignature);
  if (!camelot) return null;
  
  const standardKey = CAMELOT_TO_KEY[camelot];
  const mode: KeyMode = camelot.endsWith('A') ? 'minor' : 'major';
  
  // Extract root note
  const rootStr = standardKey.replace(/m$/, '');
  const root = ROOT_TO_SEMITONE[rootStr] ?? 0;
  
  return {
    root,
    mode,
    camelot,
    original: keySignature,
  };
}

// =============================================================================
// Camelot Distance & Compatibility
// =============================================================================

/**
 * Extract the number and letter from a Camelot key.
 */
function parseCamelot(key: CamelotKey): { number: number; letter: 'A' | 'B' } {
  const letter = key.slice(-1) as 'A' | 'B';
  const number = parseInt(key.slice(0, -1), 10);
  return { number, letter };
}

/**
 * Calculate the distance between two Camelot keys on the wheel.
 * Returns a value from 0 to 6 (half the wheel).
 */
export function getCamelotDistance(source: CamelotKey, target: CamelotKey): number {
  const s = parseCamelot(source);
  const t = parseCamelot(target);
  
  // Calculate circular distance on the number (1-12)
  const rawDiff = Math.abs(s.number - t.number);
  const circularDiff = Math.min(rawDiff, 12 - rawDiff);
  
  // Add 1 if crossing between A and B rings (unless same number)
  const ringDiff = s.letter !== t.letter ? 1 : 0;
  
  // Special case: same number, different letter = relative major/minor (distance 0)
  if (circularDiff === 0 && ringDiff === 1) {
    return 0; // Relative major/minor is highly compatible
  }
  
  return circularDiff + (ringDiff && circularDiff > 0 ? 1 : 0);
}

/**
 * Determine the harmonic relationship between two Camelot keys.
 */
function getRelationship(source: CamelotKey, target: CamelotKey): HarmonicRelationship {
  if (source === target) return 'same';
  
  const s = parseCamelot(source);
  const t = parseCamelot(target);
  
  // Same number, different letter = relative major/minor
  if (s.number === t.number && s.letter !== t.letter) {
    return 'relative';
  }
  
  // Calculate circular difference
  const rawDiff = t.number - s.number;
  const normalizedDiff = ((rawDiff % 12) + 12) % 12; // 0-11
  
  // Same ring (letter)
  if (s.letter === t.letter) {
    if (normalizedDiff === 1 || normalizedDiff === 11) return 'adjacent';
    if (normalizedDiff === 7 || normalizedDiff === 5) return 'perfect5th';
  }
  
  // Different ring
  if (s.letter !== t.letter) {
    // Parallel (same root, different mode) would be same number
    // We already handled that above as 'relative'
    if (normalizedDiff === 1 || normalizedDiff === 11) return 'adjacent';
    if (normalizedDiff === 0) return 'relative'; // Redundant but clear
  }
  
  // Calculate total distance
  const distance = getCamelotDistance(source, target);
  if (distance <= 2) return 'adjacent';
  
  return 'clash';
}

/**
 * Calculate the compatibility score based on Camelot distance.
 */
function getCompatibilityScore(relationship: HarmonicRelationship, distance: number): Normalized {
  switch (relationship) {
    case 'same': return 1.0;
    case 'relative': return 0.85;
    case 'perfect5th': return 0.80;
    case 'perfect4th': return 0.75;
    case 'adjacent': return 0.70;
    case 'parallel': return 0.65;
    case 'clash':
    default:
      // Decrease score based on distance
      return Math.max(0, 0.5 - (distance - 3) * 0.1);
  }
}

/**
 * Calculate suggested pitch shift to improve compatibility.
 * Returns a value in semitones (-2 to +2).
 */
function getSuggestedPitchShift(source: CamelotKey, target: CamelotKey): number {
  const s = parseCamelot(source);
  const t = parseCamelot(target);
  
  // Calculate the shortest path on the wheel
  const rawDiff = t.number - s.number;
  const normalizedDiff = ((rawDiff % 12) + 12) % 12;
  
  // If distance is 2, suggest shifting by 1 semitone
  if (normalizedDiff === 2) return 1;
  if (normalizedDiff === 10) return -1;
  
  // If distance is greater, suggest larger shift (clamped to +/- 2)
  if (normalizedDiff > 2 && normalizedDiff <= 6) {
    return Math.min(2, normalizedDiff - 1);
  }
  if (normalizedDiff > 6 && normalizedDiff < 10) {
    return Math.max(-2, normalizedDiff - 11);
  }
  
  return 0;
}

// =============================================================================
// Main Compatibility Function
// =============================================================================

/**
 * Get the harmonic compatibility between two keys.
 * 
 * @param source - The currently playing track's key (Camelot notation)
 * @param target - The next track's key (Camelot notation)
 * @returns HarmonicScore with compatibility details
 * 
 * @example
 * getCompatibility('8A', '8A') // Same key: { compatibility: 1.0, relationship: 'same', ... }
 * getCompatibility('8A', '9A') // +1: { compatibility: 0.9, relationship: 'adjacent', ... }
 * getCompatibility('8A', '8B') // Relative: { compatibility: 0.85, relationship: 'relative', ... }
 */
export function getCompatibility(source: CamelotKey, target: CamelotKey): HarmonicScore {
  const relationship = getRelationship(source, target);
  const distance = getCamelotDistance(source, target);
  const compatibility = getCompatibilityScore(relationship, distance);
  const suggestedPitchShift = getSuggestedPitchShift(source, target);
  
  return {
    compatibility,
    relationship,
    suggestedPitchShift,
    recommended: compatibility >= 0.7,
  };
}

/**
 * Get detailed compatibility result including both keys.
 */
export function getCompatibilityDetailed(source: CamelotKey, target: CamelotKey): CompatibilityResult {
  const score = getCompatibility(source, target);
  const distance = getCamelotDistance(source, target);
  
  return {
    ...score,
    sourceKey: source,
    targetKey: target,
    wheelDistance: distance,
  };
}

/**
 * Get all compatible keys for a given key (sorted by compatibility).
 */
export function getCompatibleKeys(source: CamelotKey): Array<{ key: CamelotKey; score: HarmonicScore }> {
  const allKeys: CamelotKey[] = [
    '1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
    '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B',
  ];
  
  return allKeys
    .map(key => ({ key, score: getCompatibility(source, key) }))
    .filter(result => result.score.recommended)
    .sort((a, b) => b.score.compatibility - a.score.compatibility);
}
