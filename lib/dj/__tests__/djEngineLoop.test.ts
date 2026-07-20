/**
 * DJ Engine Loop Tests
 * 
 * These tests verify the continuity of the "game loop" - ensuring that
 * the DJ engine state machine transitions correctly through all phases
 * of playback and transitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  djReducer,
  getInitialDJState,
  createTransitionPlan,
  isGoodTransitionMoment,
  type DJState,
  type DJEvent,
  type DeckSnapshot,
  type AnalysisSnapshot,
  constructBeatGridFromBpm,
} from '../index';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockDeckSnapshot(id: 'A' | 'B', bpm: number = 120): DeckSnapshot {
  return {
    id,
    track: {
      id: id === 'A' ? 1 : 2,
      title: `Test Track ${id}`,
      bpm,
    },
    positionSec: 0,
    beatGrid: constructBeatGridFromBpm(bpm),
    structureMap: null,
    energyCurve: null,
  };
}

function createMockAnalysis(): AnalysisSnapshot {
  return {
    bpm: 120,
    bpmSource: 'detected',
    section: 'unknown',
    overallEnergy: 0.5,
    bassEnergy: 0.4,
    stillDurationMs: 0,
    dropDetected: false,
    beatPhase: 0,
    timeToNextBeatMs: 250,
  };
}

function dispatch(state: DJState, event: DJEvent): DJState {
  return djReducer(state, event);
}

// =============================================================================
// State Machine Continuity Tests
// =============================================================================

describe('DJ Engine Loop Continuity', () => {
  describe('Full Playback Cycle', () => {
    it('should transition through idle -> loading -> ready -> playing', () => {
      let state = getInitialDJState();
      expect(state.type).toBe('idle');

      // Load track
      state = dispatch(state, { type: 'LOAD_TRACK', trackId: 1, deck: 'A' });
      expect(state.type).toBe('loading');

      // Track loaded
      const deckA = createMockDeckSnapshot('A');
      state = dispatch(state, { type: 'TRACK_LOADED', deck: deckA });
      expect(state.type).toBe('ready');

      // Play
      state = dispatch(state, { type: 'PLAY' });
      expect(state.type).toBe('playing');
    });

    it('should handle pause and resume correctly', () => {
      let state = getInitialDJState();
      
      // Get to playing state
      state = dispatch(state, { type: 'LOAD_TRACK', trackId: 1, deck: 'A' });
      state = dispatch(state, { type: 'TRACK_LOADED', deck: createMockDeckSnapshot('A') });
      state = dispatch(state, { type: 'PLAY' });
      expect(state.type).toBe('playing');

      // Pause
      state = dispatch(state, { type: 'PAUSE' });
      expect(state.type).toBe('paused');

      // Resume (using PLAY from paused state)
      state = dispatch(state, { type: 'PLAY' });
      expect(state.type).toBe('playing');
    });
  });

  describe('Transition Cycle', () => {
    it('should transition through playing -> cueing -> planned -> crossfading -> playing', () => {
      let state = getInitialDJState();
      
      // Get to playing state with deck A
      state = dispatch(state, { type: 'LOAD_TRACK', trackId: 1, deck: 'A' });
      state = dispatch(state, { type: 'TRACK_LOADED', deck: createMockDeckSnapshot('A') });
      state = dispatch(state, { type: 'PLAY' });
      expect(state.type).toBe('playing');

      // Update analysis
      state = dispatch(state, { type: 'ANALYSIS_UPDATE', analysis: createMockAnalysis() });
      expect(state.type).toBe('playing');

      // Cue next track on deck B
      const deckB = createMockDeckSnapshot('B');
      state = dispatch(state, { type: 'CUE_READY', deck: deckB });
      expect(state.type).toBe('cueing');

      // Plan transition
      if (state.type === 'cueing') {
        const plan = createTransitionPlan({
          outgoingDeck: state.activeDeck,
          incomingDeck: state.cueDeck,
          currentTimeSec: 60,
          analysis: state.analysis,
        });
        state = dispatch(state, { type: 'PLAN_TRANSITION', plan });
        expect(state.type).toBe('planned');
      }

      // Start crossfade
      state = dispatch(state, { type: 'START_CROSSFADE' });
      expect(state.type).toBe('crossfading');

      // Progress crossfade
      state = dispatch(state, { type: 'CROSSFADE_TICK', progress: 0.5 });
      expect(state.type).toBe('crossfading');
      if (state.type === 'crossfading') {
        expect(state.progress).toBe(0.5);
      }

      // Complete crossfade
      state = dispatch(state, { type: 'CROSSFADE_COMPLETE' });
      expect(state.type).toBe('playing');
    });

    it('should maintain active deck info after crossfade completion', () => {
      let state = getInitialDJState();
      
      // Get to playing with deck A
      state = dispatch(state, { type: 'LOAD_TRACK', trackId: 1, deck: 'A' });
      const deckA = createMockDeckSnapshot('A');
      state = dispatch(state, { type: 'TRACK_LOADED', deck: deckA });
      state = dispatch(state, { type: 'PLAY' });

      // Cue and transition to deck B
      const deckB = createMockDeckSnapshot('B');
      state = dispatch(state, { type: 'CUE_READY', deck: deckB });
      
      if (state.type === 'cueing') {
        const plan = createTransitionPlan({
          outgoingDeck: state.activeDeck,
          incomingDeck: state.cueDeck,
          currentTimeSec: 60,
          analysis: state.analysis,
        });
        state = dispatch(state, { type: 'PLAN_TRANSITION', plan });
      }
      
      state = dispatch(state, { type: 'START_CROSSFADE' });
      state = dispatch(state, { type: 'CROSSFADE_COMPLETE' });

      // After crossfade, deck B should be active
      expect(state.type).toBe('playing');
      if (state.type === 'playing') {
        expect(state.activeDeck.id).toBe('B');
      }
    });
  });

  describe('Multiple Consecutive Transitions', () => {
    it('should handle A -> B -> A transitions correctly', () => {
      let state = getInitialDJState();
      
      // Start with deck A
      state = dispatch(state, { type: 'LOAD_TRACK', trackId: 1, deck: 'A' });
      state = dispatch(state, { type: 'TRACK_LOADED', deck: createMockDeckSnapshot('A', 120) });
      state = dispatch(state, { type: 'PLAY' });
      expect(state.type).toBe('playing');
      if (state.type === 'playing') {
        expect(state.activeDeck.id).toBe('A');
      }

      // First transition: A -> B
      state = dispatch(state, { type: 'CUE_READY', deck: createMockDeckSnapshot('B', 122) });
      if (state.type === 'cueing') {
        const plan = createTransitionPlan({
          outgoingDeck: state.activeDeck,
          incomingDeck: state.cueDeck,
          currentTimeSec: 60,
          analysis: state.analysis,
        });
        state = dispatch(state, { type: 'PLAN_TRANSITION', plan });
      }
      state = dispatch(state, { type: 'START_CROSSFADE' });
      state = dispatch(state, { type: 'CROSSFADE_COMPLETE' });
      
      expect(state.type).toBe('playing');
      if (state.type === 'playing') {
        expect(state.activeDeck.id).toBe('B');
      }

      // Second transition: B -> A (with a new track)
      const newDeckA: DeckSnapshot = {
        ...createMockDeckSnapshot('A', 118),
        track: { id: 3, title: 'New Track A', bpm: 118 },
      };
      state = dispatch(state, { type: 'CUE_READY', deck: newDeckA });
      
      if (state.type === 'cueing') {
        const plan = createTransitionPlan({
          outgoingDeck: state.activeDeck,
          incomingDeck: state.cueDeck,
          currentTimeSec: 60,
          analysis: state.analysis,
        });
        state = dispatch(state, { type: 'PLAN_TRANSITION', plan });
      }
      state = dispatch(state, { type: 'START_CROSSFADE' });
      state = dispatch(state, { type: 'CROSSFADE_COMPLETE' });

      expect(state.type).toBe('playing');
      if (state.type === 'playing') {
        expect(state.activeDeck.id).toBe('A');
        expect(state.activeDeck.track.id).toBe(3);
      }
    });
  });

  describe('Edge Cases - State Recovery', () => {
    it('should not allow cueing during crossfade', () => {
      let state = getInitialDJState();
      
      // Get to crossfading state
      state = dispatch(state, { type: 'LOAD_TRACK', trackId: 1, deck: 'A' });
      state = dispatch(state, { type: 'TRACK_LOADED', deck: createMockDeckSnapshot('A') });
      state = dispatch(state, { type: 'PLAY' });
      state = dispatch(state, { type: 'CUE_READY', deck: createMockDeckSnapshot('B') });
      
      if (state.type === 'cueing') {
        const plan = createTransitionPlan({
          outgoingDeck: state.activeDeck,
          incomingDeck: state.cueDeck,
          currentTimeSec: 60,
          analysis: state.analysis,
        });
        state = dispatch(state, { type: 'PLAN_TRANSITION', plan });
      }
      state = dispatch(state, { type: 'START_CROSSFADE' });
      expect(state.type).toBe('crossfading');

      // Try to cue another track during crossfade - should be ignored
      const prevState = state;
      state = dispatch(state, { type: 'CUE_READY', deck: createMockDeckSnapshot('A') });
      
      // State should remain crossfading (event ignored)
      expect(state.type).toBe('crossfading');
    });

    it('should handle track load failure gracefully', () => {
      let state = getInitialDJState();
      
      state = dispatch(state, { type: 'LOAD_TRACK', trackId: 1, deck: 'A' });
      expect(state.type).toBe('loading');

      // Simulate load failure
      state = dispatch(state, { type: 'TRACK_LOAD_FAILED', error: 'Network error' });
      expect(state.type).toBe('idle');
    });
  });

  describe('Analysis Continuity', () => {
    it('should update analysis in playing state', () => {
      let state = getInitialDJState();
      
      // Get to playing
      state = dispatch(state, { type: 'LOAD_TRACK', trackId: 1, deck: 'A' });
      state = dispatch(state, { type: 'TRACK_LOADED', deck: createMockDeckSnapshot('A') });
      state = dispatch(state, { type: 'PLAY' });

      // Update analysis multiple times
      for (let i = 0; i < 10; i++) {
        const analysis: AnalysisSnapshot = {
          ...createMockAnalysis(),
          overallEnergy: i / 10,
        };
        state = dispatch(state, { type: 'ANALYSIS_UPDATE', analysis });
        
        expect(state.type).toBe('playing');
        if (state.type === 'playing') {
          expect(state.analysis.overallEnergy).toBe(i / 10);
        }
      }
    });

    it('should preserve analysis during transitions', () => {
      let state = getInitialDJState();
      
      // Get to playing with specific analysis
      state = dispatch(state, { type: 'LOAD_TRACK', trackId: 1, deck: 'A' });
      state = dispatch(state, { type: 'TRACK_LOADED', deck: createMockDeckSnapshot('A') });
      state = dispatch(state, { type: 'PLAY' });
      
      const analysis: AnalysisSnapshot = { ...createMockAnalysis(), bpm: 128 };
      state = dispatch(state, { type: 'ANALYSIS_UPDATE', analysis });

      // Start cueing - analysis should be preserved
      state = dispatch(state, { type: 'CUE_READY', deck: createMockDeckSnapshot('B') });
      if (state.type === 'cueing') {
        expect(state.analysis.bpm).toBe(128);
      }
    });
  });

  describe('Transition Timing', () => {
    it('isGoodTransitionMoment should return true at planned start boundary', () => {
      const basePlan = createTransitionPlan({
        outgoingDeck: createMockDeckSnapshot('A'),
        incomingDeck: createMockDeckSnapshot('B'),
        currentTimeSec: 30,
        analysis: createMockAnalysis(),
      });
      const plan = {
        ...basePlan,
        startBoundary: { ...basePlan.startBoundary, timeSec: 60 },
      };

      // Exactly at transition time
      expect(isGoodTransitionMoment(60, plan)).toBe(true);
      
      // Slightly after (within tolerance)
      expect(isGoodTransitionMoment(60.1, plan)).toBe(true);
      
      // Too early
      expect(isGoodTransitionMoment(59, plan)).toBe(false);
      
      // Way past
      expect(isGoodTransitionMoment(62, plan)).toBe(false);
    });
  });
});

describe('Crossfade Progress Calculation', () => {
  it('should calculate progress correctly based on incoming deck time', () => {
    // Simulating the logic from useDJEngine:
    // progress = Math.min(1, incomingDeck.currentTime / crossfadeDurationSec)
    
    const crossfadeDurationSec = 32;
    
    expect(Math.min(1, 0 / crossfadeDurationSec)).toBe(0);
    expect(Math.min(1, 16 / crossfadeDurationSec)).toBe(0.5);
    expect(Math.min(1, 32 / crossfadeDurationSec)).toBe(1);
    expect(Math.min(1, 40 / crossfadeDurationSec)).toBe(1); // Clamped at 1
  });
});
