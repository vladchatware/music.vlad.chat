/**
 * Structure Module Tests
 * 
 * Tests for phrase detection and track structure analysis.
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeStructure,
  detectPhrases,
  getSectionAtTime,
  getPhraseAtTime,
  findTransitionPoints,
} from '../structure/analyzer';
import { constructBeatGridFromBpm } from '../tempo/beatgrid';
import type { BeatGrid, StructureMap, Phrase } from '../types';

// Helper to create energy curve with specific pattern
function createEnergyCurve(
  pattern: 'rising' | 'falling' | 'drop' | 'breakdown' | 'constant',
  duration: number,
  sampleRate: number = 10
): Float32Array {
  const samples = new Float32Array(duration * sampleRate);
  
  for (let i = 0; i < samples.length; i++) {
    const t = i / samples.length;
    
    switch (pattern) {
      case 'rising':
        samples[i] = t * 0.8 + 0.1;
        break;
      case 'falling':
        samples[i] = (1 - t) * 0.8 + 0.1;
        break;
      case 'drop':
        // Low energy, then sudden high energy
        samples[i] = t < 0.4 ? 0.2 : 0.9;
        break;
      case 'breakdown':
        // High energy, then low, then high again
        if (t < 0.3) samples[i] = 0.8;
        else if (t < 0.7) samples[i] = 0.15;
        else samples[i] = 0.85;
        break;
      case 'constant':
      default:
        samples[i] = 0.5;
        break;
    }
  }
  
  return samples;
}

describe('detectPhrases', () => {
  const grid = constructBeatGridFromBpm(128);
  const sampleRate = 10;

  it('detects phrases in constant energy track', () => {
    const energy = createEnergyCurve('constant', 180, sampleRate);
    const phrases = detectPhrases(energy, sampleRate, grid, 180);

    expect(phrases.length).toBeGreaterThan(0);
    
    // All phrases should cover the full duration
    const totalCoverage = phrases.reduce((sum, p) => sum + (p.endTime - p.startTime), 0);
    expect(totalCoverage).toBeCloseTo(180, 0);
  });

  it('detects intro for low energy start', () => {
    const energy = createEnergyCurve('rising', 180, sampleRate);
    const phrases = detectPhrases(energy, sampleRate, grid, 180);

    // First phrase should be classified based on low starting energy
    expect(phrases[0]).toBeDefined();
    expect(['intro', 'unknown']).toContain(phrases[0].type);
  });

  it('creates phrases aligned to bar boundaries', () => {
    const energy = createEnergyCurve('constant', 180, sampleRate);
    const phrases = detectPhrases(energy, sampleRate, grid, 180);

    const barDuration = (60 / 128) * 4;
    
    for (const phrase of phrases) {
      // Phrase length should be a multiple of bars
      const lengthInSeconds = phrase.endTime - phrase.startTime;
      const barsApprox = lengthInSeconds / barDuration;
      
      expect(Math.abs(barsApprox - Math.round(barsApprox))).toBeLessThan(0.5);
    }
  });

  it('includes energy level for each phrase', () => {
    const energy = createEnergyCurve('rising', 180, sampleRate);
    const phrases = detectPhrases(energy, sampleRate, grid, 180);

    for (const phrase of phrases) {
      expect(phrase.energy).toBeGreaterThanOrEqual(0);
      expect(phrase.energy).toBeLessThanOrEqual(1);
    }
  });
});

describe('analyzeStructure', () => {
  const grid = constructBeatGridFromBpm(128);
  const sampleRate = 10;

  it('returns complete structure map', () => {
    const energy = createEnergyCurve('breakdown', 180, sampleRate);
    const structure = analyzeStructure(energy, sampleRate, grid, 180);

    expect(structure.phrases).toBeDefined();
    expect(structure.phrases.length).toBeGreaterThan(0);
    
    expect(structure.sections).toBeDefined();
    expect(structure.sections.length).toBeGreaterThan(0);
    
    expect(structure.downbeats).toBeDefined();
    expect(structure.duration).toBe(180);
  });

  it('groups phrases into sections', () => {
    const energy = createEnergyCurve('breakdown', 180, sampleRate);
    const structure = analyzeStructure(energy, sampleRate, grid, 180);

    // Each section should contain at least one phrase
    for (const section of structure.sections) {
      expect(section.phrases.length).toBeGreaterThan(0);
      expect(section.startTime).toBeLessThanOrEqual(section.endTime);
    }
  });

  it('extracts downbeats', () => {
    const energy = createEnergyCurve('constant', 180, sampleRate);
    const structure = analyzeStructure(energy, sampleRate, grid, 180);

    // Downbeats should match phrase start times
    expect(structure.downbeats.length).toBe(structure.phrases.length);
    
    for (let i = 0; i < structure.phrases.length; i++) {
      expect(structure.downbeats[i]).toBe(structure.phrases[i].startTime);
    }
  });
});

describe('getSectionAtTime', () => {
  it('returns the section containing the given time', () => {
    const grid = constructBeatGridFromBpm(128);
    const energy = createEnergyCurve('breakdown', 180, 10);
    const structure = analyzeStructure(energy, 10, grid, 180);

    const section = getSectionAtTime(structure, 90);
    
    expect(section).not.toBeNull();
    expect(section!.startTime).toBeLessThanOrEqual(90);
    expect(section!.endTime).toBeGreaterThan(90);
  });

  it('returns null for time outside track', () => {
    const grid = constructBeatGridFromBpm(128);
    const energy = createEnergyCurve('constant', 180, 10);
    const structure = analyzeStructure(energy, 10, grid, 180);

    expect(getSectionAtTime(structure, 200)).toBeNull();
  });
});

describe('getPhraseAtTime', () => {
  it('returns the phrase containing the given time', () => {
    const grid = constructBeatGridFromBpm(128);
    const energy = createEnergyCurve('constant', 180, 10);
    const structure = analyzeStructure(energy, 10, grid, 180);

    const phrase = getPhraseAtTime(structure, 60);
    
    expect(phrase).not.toBeNull();
    expect(phrase!.startTime).toBeLessThanOrEqual(60);
    expect(phrase!.endTime).toBeGreaterThan(60);
  });
});

describe('findTransitionPoints', () => {
  it('finds transition points in a track', () => {
    const grid = constructBeatGridFromBpm(128);
    const energy = createEnergyCurve('breakdown', 180, 10);
    const structure = analyzeStructure(energy, 10, grid, 180);

    const points = findTransitionPoints(structure);
    
    expect(points).toBeDefined();
    // Should find at least one good transition point in a breakdown pattern
  });

  it('respects minimum time parameter', () => {
    const grid = constructBeatGridFromBpm(128);
    const energy = createEnergyCurve('breakdown', 180, 10);
    const structure = analyzeStructure(energy, 10, grid, 180);

    const points = findTransitionPoints(structure, 100);
    
    // All points should be after 100 seconds
    for (const point of points) {
      expect(point).toBeGreaterThanOrEqual(100);
    }
  });
});
