/**
 * Transition Planner Tests
 * 
 * Tests for the transition planning logic that combines all matchers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTransitionPlan,
  isGoodTransitionMoment,
  calculateCrossfadeProgress,
  getRecommendedEntryPoint,
} from '../engine/transitionPlanner';
import type { DeckSnapshot, TransitionPlanInput } from '../engine/types';
import { DEFAULT_ANALYSIS_SNAPSHOT } from '../engine/types';

// Mock decks
const createMockDeck = (id: 'A' | 'B', bpm: number, key?: string): DeckSnapshot => ({
  id,
  track: {
    id: id === 'A' ? 123 : 456,
    title: `Track ${id}`,
    bpm,
    keySignature: key,
    duration: 300, // 5 minutes
  },
  positionSec: 0,
  beatGrid: {
    bpm,
    beatsPerBar: 4,
    firstDownbeat: 0,
    confidence: 0.9,
  },
  structureMap: null,
  energyCurve: null,
});

describe('createTransitionPlan', () => {
  it('creates a valid transition plan', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128),
      incomingDeck: createMockDeck('B', 126),
      currentTimeSec: 60,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input);

    expect(plan).toBeDefined();
    expect(plan.startBoundary).toBeDefined();
    expect(plan.crossfadeDurationSec).toBeGreaterThan(0);
    expect(plan.tempoAdjustment).toBeDefined();
    expect(plan.eqCurve).toBeDefined();
    expect(plan.harmonicScore).toBeDefined();
    expect(plan.energyScore).toBeDefined();
    expect(plan.quality).toBeGreaterThanOrEqual(0);
    expect(plan.quality).toBeLessThanOrEqual(1);
  });

  it('calculates tempo adjustment for different BPMs', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128),
      incomingDeck: createMockDeck('B', 124),
      currentTimeSec: 60,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input);

    // Should adjust 124 BPM to match 128 BPM
    expect(plan.tempoAdjustment.targetPlaybackRate).toBeGreaterThan(1);
    expect(plan.tempoAdjustment.feasible).toBe(true);
  });

  it('marks infeasible for very different tempos', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 100),
      incomingDeck: createMockDeck('B', 180), // 1.8x ratio, truly infeasible
      currentTimeSec: 60,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input);

    expect(plan.tempoAdjustment.feasible).toBe(false);
  });

  it('calculates harmonic compatibility when keys are provided', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128, 'Am'),
      incomingDeck: createMockDeck('B', 128, 'Em'), // Compatible key
      currentTimeSec: 60,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input);

    expect(plan.harmonicScore.compatibility).toBeGreaterThan(0.5);
  });

  it('sets start boundary in the future', () => {
    const currentTime = 60;
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128),
      incomingDeck: createMockDeck('B', 128),
      currentTimeSec: currentTime,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input);

    expect(plan.startBoundary.timeSec).toBeGreaterThan(currentTime);
  });

  it('aligns to phrase boundaries', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128),
      incomingDeck: createMockDeck('B', 128),
      currentTimeSec: 10,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input);

    // Bar duration at 128 BPM is 1.875 seconds
    const barDuration = (60 / 128) * 4;
    
    // Should be on a bar boundary
    const bars = plan.startBoundary.timeSec / barDuration;
    expect(bars % 1).toBeCloseTo(0, 1);
  });

  it('adjusts phrase bars for breakdown section', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128),
      incomingDeck: createMockDeck('B', 128),
      currentTimeSec: 60,
      analysis: { ...DEFAULT_ANALYSIS_SNAPSHOT, section: 'breakdown' },
    };

    const plan = createTransitionPlan(input);

    // Breakdown should use shorter phrases (4 bars instead of 16)
    expect(plan.startBoundary.phraseLength).toBeLessThanOrEqual(8);
  });

  it('creates an EQ curve', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128),
      incomingDeck: createMockDeck('B', 128),
      currentTimeSec: 60,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input);

    expect(plan.eqCurve.durationSec).toBe(plan.crossfadeDurationSec);
    expect(plan.eqCurve.outgoing.length).toBeGreaterThan(0);
    expect(plan.eqCurve.incoming.length).toBeGreaterThan(0);
  });

  it('respects custom options', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128),
      incomingDeck: createMockDeck('B', 128),
      currentTimeSec: 60,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input, {
      minCrossfadeSec: 8,
      maxCrossfadeSec: 8,
      eqPreset: 'smooth',
    });

    expect(plan.crossfadeDurationSec).toBe(8);
  });

  it('disables harmonic matching when option is false', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128, 'Am'),
      incomingDeck: createMockDeck('B', 128, 'Fm'), // Very different
      currentTimeSec: 60,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input, { useHarmonicMatching: false });

    expect(plan.harmonicScore.compatibility).toBe(1);
  });

  it('includes timestamp', () => {
    const input: TransitionPlanInput = {
      outgoingDeck: createMockDeck('A', 128),
      incomingDeck: createMockDeck('B', 128),
      currentTimeSec: 60,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };

    const plan = createTransitionPlan(input);

    expect(plan.createdAt).toBeGreaterThan(0);
  });
});

describe('isGoodTransitionMoment', () => {
  const mockPlan = {
    startBoundary: {
      timeSec: 120,
      barIndex: 60,
      isPhraseBoundary: true,
    },
    crossfadeDurationSec: 16,
    tempoAdjustment: { targetPlaybackRate: 1, phaseOffsetMs: 0, confidence: 0.9, feasible: true },
    eqCurve: { durationSec: 16, outgoing: [], incoming: [] },
    harmonicScore: { compatibility: 0.9, relationship: 'same' as const, suggestedPitchShift: 0, recommended: true },
    energyScore: { energyMatch: 0.8, momentumMatch: 0.9, contrastScore: 0.7, overall: 0.8 },
    quality: 0.85,
    createdAt: 0,
  };

  it('returns true at planned boundary', () => {
    expect(isGoodTransitionMoment(120, mockPlan)).toBe(true);
  });

  it('returns true within tolerance', () => {
    expect(isGoodTransitionMoment(119.9, mockPlan)).toBe(true);
    expect(isGoodTransitionMoment(120.1, mockPlan)).toBe(true);
  });

  it('returns false before tolerance window', () => {
    expect(isGoodTransitionMoment(119, mockPlan)).toBe(false);
  });

  it('returns false after tolerance window', () => {
    expect(isGoodTransitionMoment(121, mockPlan)).toBe(false);
  });

  it('respects custom tolerance', () => {
    expect(isGoodTransitionMoment(119, mockPlan, 2)).toBe(true);
    expect(isGoodTransitionMoment(121.5, mockPlan, 2)).toBe(true);
    expect(isGoodTransitionMoment(117, mockPlan, 2)).toBe(false);
  });
});

describe('calculateCrossfadeProgress', () => {
  it('returns 0 at start', () => {
    expect(calculateCrossfadeProgress(100, 100, 16)).toBe(0);
  });

  it('returns 0.5 at midpoint', () => {
    expect(calculateCrossfadeProgress(100, 108, 16)).toBe(0.5);
  });

  it('returns 1 at end', () => {
    expect(calculateCrossfadeProgress(100, 116, 16)).toBe(1);
  });

  it('clamps to 0-1 range', () => {
    expect(calculateCrossfadeProgress(100, 99, 16)).toBe(0); // Before start
    expect(calculateCrossfadeProgress(100, 120, 16)).toBe(1); // After end
  });

  it('handles zero duration', () => {
    expect(calculateCrossfadeProgress(100, 100, 0)).toBe(1);
  });
});

describe('getRecommendedEntryPoint', () => {
  it('returns 0 when not skipping intro', () => {
    const deck = createMockDeck('B', 128);
    expect(getRecommendedEntryPoint(deck, false)).toBe(0);
  });

  it('returns safe default when no structure data', () => {
    const deck = createMockDeck('B', 128);
    const entryPoint = getRecommendedEntryPoint(deck, true);
    
    expect(entryPoint).toBeGreaterThan(0);
    expect(entryPoint).toBe(30); // Default skip
  });

  it('finds first non-intro section when structure available', () => {
    const deck: DeckSnapshot = {
      ...createMockDeck('B', 128),
      structureMap: {
        phrases: [],
        downbeats: [0, 16, 32, 48],
        sections: [
          { type: 'intro', phrases: [], startTime: 0, endTime: 30, energy: 0.2 },
          { type: 'buildup', phrases: [], startTime: 30, endTime: 60, energy: 0.5 },
          { type: 'drop', phrases: [], startTime: 60, endTime: 120, energy: 0.9 },
        ],
        duration: 180,
      },
    };

    const entryPoint = getRecommendedEntryPoint(deck, true);
    
    // Should skip intro and find buildup at 30s
    expect(entryPoint).toBeGreaterThanOrEqual(30);
  });
});
