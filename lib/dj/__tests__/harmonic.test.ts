/**
 * Harmonic Module Tests
 * 
 * Tests for Camelot wheel key parsing and compatibility scoring.
 */

import { describe, it, expect } from 'vitest';
import {
  parseKey,
  parseKeyDetailed,
  camelotToKey,
  getCompatibility,
  getCompatibilityDetailed,
  getCamelotDistance,
  getCompatibleKeys,
} from '../harmonic/camelot';
import type { CamelotKey } from '../types';

describe('parseKey', () => {
  describe('standard key notation', () => {
    it('parses major keys correctly', () => {
      expect(parseKey('C')).toBe('8B');
      expect(parseKey('G')).toBe('9B');
      expect(parseKey('D')).toBe('10B');
      expect(parseKey('A')).toBe('11B');
      expect(parseKey('E')).toBe('12B');
      expect(parseKey('B')).toBe('1B');
      expect(parseKey('F#')).toBe('2B');
      expect(parseKey('Gb')).toBe('2B');
      expect(parseKey('C#')).toBe('3B');
      expect(parseKey('Db')).toBe('3B');
      expect(parseKey('Ab')).toBe('4B');
      expect(parseKey('Eb')).toBe('5B');
      expect(parseKey('Bb')).toBe('6B');
      expect(parseKey('F')).toBe('7B');
    });

    it('parses minor keys correctly', () => {
      expect(parseKey('Am')).toBe('8A');
      expect(parseKey('Em')).toBe('9A');
      expect(parseKey('Bm')).toBe('10A');
      expect(parseKey('F#m')).toBe('11A');
      expect(parseKey('C#m')).toBe('12A');
      expect(parseKey('G#m')).toBe('1A');
      expect(parseKey('Abm')).toBe('1A');
      expect(parseKey('D#m')).toBe('2A');
      expect(parseKey('Ebm')).toBe('2A');
      expect(parseKey('A#m')).toBe('3A');
      expect(parseKey('Bbm')).toBe('3A');
      expect(parseKey('Fm')).toBe('4A');
      expect(parseKey('Cm')).toBe('5A');
      expect(parseKey('Gm')).toBe('6A');
      expect(parseKey('Dm')).toBe('7A');
    });
  });

  describe('alternative notations', () => {
    it('parses "minor" suffix', () => {
      expect(parseKey('A minor')).toBe('8A');
      expect(parseKey('Aminor')).toBe('8A');
    });

    it('parses "min" suffix', () => {
      expect(parseKey('Amin')).toBe('8A');
    });

    it('parses "major" suffix', () => {
      expect(parseKey('C major')).toBe('8B');
      expect(parseKey('Cmaj')).toBe('8B');
    });

    it('is case insensitive', () => {
      expect(parseKey('am')).toBe('8A');
      expect(parseKey('AM')).toBe('8A');
      expect(parseKey('c')).toBe('8B');
    });
  });

  describe('Camelot notation passthrough', () => {
    it('returns Camelot keys unchanged', () => {
      expect(parseKey('8A')).toBe('8A');
      expect(parseKey('8B')).toBe('8B');
      expect(parseKey('1A')).toBe('1A');
      expect(parseKey('12B')).toBe('12B');
    });

    it('is case insensitive for Camelot', () => {
      expect(parseKey('8a')).toBe('8A');
      expect(parseKey('8b')).toBe('8B');
    });
  });

  describe('invalid input', () => {
    it('returns null for empty input', () => {
      expect(parseKey('')).toBeNull();
      expect(parseKey('   ')).toBeNull();
    });

    it('returns null for invalid keys', () => {
      expect(parseKey('X')).toBeNull();
      expect(parseKey('H#m')).toBeNull();
      expect(parseKey('13A')).toBeNull();
      expect(parseKey('0B')).toBeNull();
    });
  });
});

describe('camelotToKey', () => {
  it('converts A ring (minor) keys', () => {
    expect(camelotToKey('8A')).toBe('Am');
    expect(camelotToKey('1A')).toBe('G#m');
    expect(camelotToKey('12A')).toBe('C#m');
  });

  it('converts B ring (major) keys', () => {
    expect(camelotToKey('8B')).toBe('C');
    expect(camelotToKey('1B')).toBe('B');
    expect(camelotToKey('12B')).toBe('E');
  });
});

describe('getCamelotDistance', () => {
  it('returns 0 for same key', () => {
    expect(getCamelotDistance('8A', '8A')).toBe(0);
    expect(getCamelotDistance('1B', '1B')).toBe(0);
  });

  it('returns 0 for relative major/minor (same number, different letter)', () => {
    expect(getCamelotDistance('8A', '8B')).toBe(0);
    expect(getCamelotDistance('1A', '1B')).toBe(0);
  });

  it('returns 1 for adjacent keys on the wheel', () => {
    expect(getCamelotDistance('8A', '9A')).toBe(1);
    expect(getCamelotDistance('8A', '7A')).toBe(1);
    expect(getCamelotDistance('1A', '12A')).toBe(1); // Wrap around
    expect(getCamelotDistance('12A', '1A')).toBe(1);
  });

  it('returns correct distance for keys across the wheel', () => {
    expect(getCamelotDistance('8A', '10A')).toBe(2);
    expect(getCamelotDistance('8A', '2A')).toBe(6); // Maximum distance
    expect(getCamelotDistance('1A', '7A')).toBe(6);
  });
});

describe('getCompatibility', () => {
  it('returns perfect compatibility for same key', () => {
    const result = getCompatibility('8A', '8A');
    expect(result.compatibility).toBe(1.0);
    expect(result.relationship).toBe('same');
    expect(result.recommended).toBe(true);
    expect(result.suggestedPitchShift).toBe(0);
  });

  it('returns high compatibility for relative major/minor', () => {
    const result = getCompatibility('8A', '8B');
    expect(result.compatibility).toBe(0.85);
    expect(result.relationship).toBe('relative');
    expect(result.recommended).toBe(true);
  });

  it('returns good compatibility for adjacent keys', () => {
    const result = getCompatibility('8A', '9A');
    expect(result.compatibility).toBe(0.7);
    expect(result.relationship).toBe('adjacent');
    expect(result.recommended).toBe(true);
  });

  it('returns low compatibility for distant keys', () => {
    const result = getCompatibility('8A', '2A'); // 6 steps away
    expect(result.compatibility).toBeLessThan(0.5);
    expect(result.relationship).toBe('clash');
    expect(result.recommended).toBe(false);
  });

  it('suggests pitch shift for near-compatible keys', () => {
    const result = getCompatibility('8A', '10A'); // 2 steps away
    expect(result.suggestedPitchShift).not.toBe(0);
  });
});

describe('getCompatibleKeys', () => {
  it('returns keys sorted by compatibility', () => {
    const compatible = getCompatibleKeys('8A');
    
    // First result should be the same key
    expect(compatible[0].key).toBe('8A');
    expect(compatible[0].score.compatibility).toBe(1.0);
    
    // All results should be recommended
    compatible.forEach(result => {
      expect(result.score.recommended).toBe(true);
    });
    
    // Should be sorted by compatibility (descending)
    for (let i = 1; i < compatible.length; i++) {
      expect(compatible[i].score.compatibility)
        .toBeLessThanOrEqual(compatible[i - 1].score.compatibility);
    }
  });

  it('includes relative major/minor', () => {
    const compatible = getCompatibleKeys('8A');
    const hasRelative = compatible.some(r => r.key === '8B');
    expect(hasRelative).toBe(true);
  });

  it('includes adjacent keys', () => {
    const compatible = getCompatibleKeys('8A');
    const has7A = compatible.some(r => r.key === '7A');
    const has9A = compatible.some(r => r.key === '9A');
    expect(has7A).toBe(true);
    expect(has9A).toBe(true);
  });
});

describe('parseKeyDetailed', () => {
  it('returns detailed key information', () => {
    const result = parseKeyDetailed('Am');
    expect(result).not.toBeNull();
    expect(result!.camelot).toBe('8A');
    expect(result!.mode).toBe('minor');
    expect(result!.root).toBe(9); // A = 9 semitones from C
    expect(result!.original).toBe('Am');
  });

  it('returns null for invalid input', () => {
    expect(parseKeyDetailed('')).toBeNull();
    expect(parseKeyDetailed('invalid')).toBeNull();
  });
});
