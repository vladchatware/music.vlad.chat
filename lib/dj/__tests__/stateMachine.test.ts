/**
 * State Machine Tests
 * 
 * Tests for the DJ engine state machine - ensures deterministic state transitions.
 */

import { describe, it, expect } from 'vitest';
import {
  getInitialDJState,
  djReducer,
  djReducerSimple,
  isIdle,
  isLoading,
  isReady,
  isPlaying,
  isCueing,
  isPlanned,
  isCrossfading,
  isPaused,
  isTrackPlaying,
  isTransitionActive,
  getActiveDeck,
  getCurrentAnalysis,
  getCurrentPlan,
  getCrossfadeProgress,
} from '../engine/stateMachine';
import type { DJState, DJEvent, DeckSnapshot } from '../engine/types';
import type { TransitionPlan } from '../types';
import { DEFAULT_ANALYSIS_SNAPSHOT } from '../engine/types';

// Test fixtures
const mockDeckSnapshot: DeckSnapshot = {
  id: 'A',
  track: {
    id: 123,
    title: 'Test Track',
    bpm: 128,
  },
  positionSec: 0,
  beatGrid: {
    bpm: 128,
    beatsPerBar: 4,
    firstDownbeat: 0,
    confidence: 0.9,
  },
  structureMap: null,
  energyCurve: null,
};

const mockDeckSnapshotB: DeckSnapshot = {
  ...mockDeckSnapshot,
  id: 'B',
  track: {
    id: 456,
    title: 'Test Track B',
    bpm: 126,
  },
};

const mockTransitionPlan: TransitionPlan = {
  startBoundary: {
    timeSec: 120,
    barIndex: 60,
    isPhraseBoundary: true,
    phraseLength: 16,
  },
  crossfadeDurationSec: 16,
  tempoAdjustment: {
    targetPlaybackRate: 1.016,
    phaseOffsetMs: 0,
    confidence: 0.9,
    feasible: true,
  },
  eqCurve: {
    durationSec: 16,
    outgoing: [],
    incoming: [],
  },
  harmonicScore: {
    compatibility: 0.85,
    relationship: 'relative',
    suggestedPitchShift: 0,
    recommended: true,
  },
  energyScore: {
    energyMatch: 0.8,
    momentumMatch: 0.9,
    contrastScore: 0.7,
    overall: 0.8,
  },
  quality: 0.85,
  createdAt: 0,
};

describe('getInitialDJState', () => {
  it('returns idle state', () => {
    const state = getInitialDJState();
    expect(state.type).toBe('idle');
    expect(isIdle(state)).toBe(true);
  });
});

describe('State Transitions from Idle', () => {
  const idleState = getInitialDJState();

  it('transitions to loading on LOAD_TRACK', () => {
    const result = djReducer(idleState, { type: 'LOAD_TRACK', trackId: 123 });
    
    expect(result.state.type).toBe('loading');
    expect(isLoading(result.state)).toBe(true);
    
    if (result.state.type === 'loading') {
      expect(result.state.trackId).toBe(123);
      expect(result.state.deck).toBe('A');
    }
    
    // Should have side effect to load audio
    expect(result.sideEffects.length).toBe(1);
    expect(result.sideEffects[0].type).toBe('LOAD_AUDIO');
  });

  it('stays idle on RESET', () => {
    const result = djReducer(idleState, { type: 'RESET' });
    expect(result.state.type).toBe('idle');
  });

  it('ignores irrelevant events', () => {
    const result = djReducer(idleState, { type: 'PLAY' });
    expect(result.state.type).toBe('idle');
    expect(result.sideEffects.length).toBe(0);
  });
});

describe('State Transitions from Loading', () => {
  const loadingState: DJState = { type: 'loading', trackId: 123, deck: 'A' };

  it('transitions to ready on TRACK_LOADED', () => {
    const result = djReducer(loadingState, { 
      type: 'TRACK_LOADED', 
      deck: mockDeckSnapshot 
    });
    
    expect(result.state.type).toBe('ready');
    expect(isReady(result.state)).toBe(true);
    
    if (result.state.type === 'ready') {
      expect(result.state.activeDeck.id).toBe('A');
    }
  });

  it('transitions to idle on TRACK_LOAD_FAILED', () => {
    const result = djReducer(loadingState, { 
      type: 'TRACK_LOAD_FAILED', 
      error: 'Network error' 
    });
    
    expect(result.state.type).toBe('idle');
  });

  it('transitions to idle on RESET', () => {
    const result = djReducer(loadingState, { type: 'RESET' });
    expect(result.state.type).toBe('idle');
    expect(result.sideEffects).toContainEqual({ type: 'RESET_ALL' });
  });
});

describe('State Transitions from Ready', () => {
  const readyState: DJState = { type: 'ready', activeDeck: mockDeckSnapshot };

  it('transitions to playing on PLAY', () => {
    const result = djReducer(readyState, { type: 'PLAY' });
    
    expect(result.state.type).toBe('playing');
    expect(isPlaying(result.state)).toBe(true);
    
    // Should have side effect to play deck
    expect(result.sideEffects).toContainEqual({ type: 'PLAY_DECK', deck: 'A' });
  });

  it('transitions to loading on LOAD_TRACK', () => {
    const result = djReducer(readyState, { type: 'LOAD_TRACK', trackId: 456 });
    expect(result.state.type).toBe('loading');
  });
});

describe('State Transitions from Playing', () => {
  const playingState: DJState = { 
    type: 'playing', 
    activeDeck: mockDeckSnapshot,
    analysis: DEFAULT_ANALYSIS_SNAPSHOT,
  };

  it('transitions to paused on PAUSE', () => {
    const result = djReducer(playingState, { type: 'PAUSE' });
    
    expect(result.state.type).toBe('paused');
    expect(isPaused(result.state)).toBe(true);
    expect(result.sideEffects).toContainEqual({ type: 'PAUSE_DECK', deck: 'A' });
  });

  it('emits SEEK side effect on SEEK', () => {
    const result = djReducer(playingState, { type: 'SEEK', positionSec: 30 });
    
    expect(result.state.type).toBe('playing');
    expect(result.sideEffects).toContainEqual({ 
      type: 'SEEK_DECK', 
      deck: 'A', 
      positionSec: 30 
    });
  });

  it('emits LOAD_AUDIO on CUE_TRACK', () => {
    const result = djReducer(playingState, { type: 'CUE_TRACK', trackId: 456 });
    
    expect(result.state.type).toBe('playing'); // Stays playing while loading
    expect(result.sideEffects).toContainEqual({ 
      type: 'LOAD_AUDIO', 
      trackId: 456, 
      deck: 'B' // Loads to inactive deck
    });
  });

  it('transitions to cueing on CUE_READY', () => {
    const result = djReducer(playingState, { 
      type: 'CUE_READY', 
      deck: mockDeckSnapshotB 
    });
    
    expect(result.state.type).toBe('cueing');
    expect(isCueing(result.state)).toBe(true);
  });

  it('updates analysis on ANALYSIS_UPDATE', () => {
    const newAnalysis = { 
      ...DEFAULT_ANALYSIS_SNAPSHOT, 
      bpm: 128, 
      section: 'drop' as const 
    };
    
    const result = djReducer(playingState, { 
      type: 'ANALYSIS_UPDATE', 
      analysis: newAnalysis 
    });
    
    expect(result.state.type).toBe('playing');
    if (result.state.type === 'playing') {
      expect(result.state.analysis.bpm).toBe(128);
    }
  });
});

describe('State Transitions from Cueing', () => {
  const cueingState: DJState = { 
    type: 'cueing', 
    activeDeck: mockDeckSnapshot,
    cueDeck: mockDeckSnapshotB,
    analysis: DEFAULT_ANALYSIS_SNAPSHOT,
  };

  it('transitions to planned on PLAN_TRANSITION', () => {
    const result = djReducer(cueingState, { 
      type: 'PLAN_TRANSITION', 
      plan: mockTransitionPlan 
    });
    
    expect(result.state.type).toBe('planned');
    expect(isPlanned(result.state)).toBe(true);
  });

  it('transitions back to playing on CANCEL_TRANSITION', () => {
    const result = djReducer(cueingState, { type: 'CANCEL_TRANSITION' });
    expect(result.state.type).toBe('playing');
  });

  it('transitions to paused on PAUSE', () => {
    const result = djReducer(cueingState, { type: 'PAUSE' });
    expect(result.state.type).toBe('paused');
  });
});

describe('State Transitions from Planned', () => {
  const plannedState: DJState = { 
    type: 'planned', 
    activeDeck: mockDeckSnapshot,
    cueDeck: mockDeckSnapshotB,
    plan: mockTransitionPlan,
    analysis: DEFAULT_ANALYSIS_SNAPSHOT,
  };

  it('transitions to crossfading on START_CROSSFADE', () => {
    const result = djReducer(plannedState, { type: 'START_CROSSFADE' });
    
    expect(result.state.type).toBe('crossfading');
    expect(isCrossfading(result.state)).toBe(true);
    
    if (result.state.type === 'crossfading') {
      expect(result.state.progress).toBe(0);
    }
    
    // Should have side effects
    expect(result.sideEffects.some(e => e.type === 'PLAY_DECK')).toBe(true);
    expect(result.sideEffects.some(e => e.type === 'START_CROSSFADE_AUTOMATION')).toBe(true);
  });

  it('updates plan on PLAN_TRANSITION', () => {
    const newPlan = { ...mockTransitionPlan, quality: 0.95 };
    const result = djReducer(plannedState, { 
      type: 'PLAN_TRANSITION', 
      plan: newPlan 
    });
    
    expect(result.state.type).toBe('planned');
    if (result.state.type === 'planned') {
      expect(result.state.plan.quality).toBe(0.95);
    }
  });

  it('transitions back to playing on CANCEL_TRANSITION', () => {
    const result = djReducer(plannedState, { type: 'CANCEL_TRANSITION' });
    expect(result.state.type).toBe('playing');
  });
});

describe('State Transitions from Crossfading', () => {
  const crossfadingState: DJState = { 
    type: 'crossfading', 
    outgoingDeck: mockDeckSnapshot,
    incomingDeck: mockDeckSnapshotB,
    plan: mockTransitionPlan,
    progress: 0,
  };

  it('updates progress on CROSSFADE_TICK', () => {
    const result = djReducer(crossfadingState, { 
      type: 'CROSSFADE_TICK', 
      progress: 0.5 
    });
    
    expect(result.state.type).toBe('crossfading');
    if (result.state.type === 'crossfading') {
      expect(result.state.progress).toBe(0.5);
    }
  });

  it('transitions to playing on CROSSFADE_COMPLETE', () => {
    const result = djReducer(crossfadingState, { type: 'CROSSFADE_COMPLETE' });
    
    expect(result.state.type).toBe('playing');
    
    // Active deck should now be the incoming deck
    if (result.state.type === 'playing') {
      expect(result.state.activeDeck.id).toBe('B');
    }
    
    // Should stop outgoing deck
    expect(result.sideEffects).toContainEqual({ type: 'STOP_DECK', deck: 'A' });
  });

  it('ignores CANCEL_TRANSITION during crossfade', () => {
    const result = djReducer(crossfadingState, { type: 'CANCEL_TRANSITION' });
    expect(result.state.type).toBe('crossfading');
  });
});

describe('State Transitions from Paused', () => {
  const pausedState: DJState = { type: 'paused', activeDeck: mockDeckSnapshot };

  it('transitions to playing on PLAY', () => {
    const result = djReducer(pausedState, { type: 'PLAY' });
    
    expect(result.state.type).toBe('playing');
    expect(result.sideEffects).toContainEqual({ type: 'PLAY_DECK', deck: 'A' });
  });

  it('allows seeking while paused', () => {
    const result = djReducer(pausedState, { type: 'SEEK', positionSec: 45 });
    
    expect(result.state.type).toBe('paused');
    expect(result.sideEffects).toContainEqual({ 
      type: 'SEEK_DECK', 
      deck: 'A', 
      positionSec: 45 
    });
  });

  it('allows loading new track while paused', () => {
    const result = djReducer(pausedState, { type: 'LOAD_TRACK', trackId: 789 });
    expect(result.state.type).toBe('loading');
  });
});

describe('State Query Functions', () => {
  describe('isTrackPlaying', () => {
    it('returns true for playing states', () => {
      expect(isTrackPlaying({ type: 'playing', activeDeck: mockDeckSnapshot, analysis: DEFAULT_ANALYSIS_SNAPSHOT })).toBe(true);
      expect(isTrackPlaying({ type: 'cueing', activeDeck: mockDeckSnapshot, cueDeck: mockDeckSnapshotB, analysis: DEFAULT_ANALYSIS_SNAPSHOT })).toBe(true);
      expect(isTrackPlaying({ type: 'planned', activeDeck: mockDeckSnapshot, cueDeck: mockDeckSnapshotB, plan: mockTransitionPlan, analysis: DEFAULT_ANALYSIS_SNAPSHOT })).toBe(true);
      expect(isTrackPlaying({ type: 'crossfading', outgoingDeck: mockDeckSnapshot, incomingDeck: mockDeckSnapshotB, plan: mockTransitionPlan, progress: 0.5 })).toBe(true);
    });

    it('returns false for non-playing states', () => {
      expect(isTrackPlaying({ type: 'idle' })).toBe(false);
      expect(isTrackPlaying({ type: 'loading', trackId: 123, deck: 'A' })).toBe(false);
      expect(isTrackPlaying({ type: 'ready', activeDeck: mockDeckSnapshot })).toBe(false);
      expect(isTrackPlaying({ type: 'paused', activeDeck: mockDeckSnapshot })).toBe(false);
    });
  });

  describe('isTransitionActive', () => {
    it('returns true for transition states', () => {
      expect(isTransitionActive({ type: 'cueing', activeDeck: mockDeckSnapshot, cueDeck: mockDeckSnapshotB, analysis: DEFAULT_ANALYSIS_SNAPSHOT })).toBe(true);
      expect(isTransitionActive({ type: 'planned', activeDeck: mockDeckSnapshot, cueDeck: mockDeckSnapshotB, plan: mockTransitionPlan, analysis: DEFAULT_ANALYSIS_SNAPSHOT })).toBe(true);
      expect(isTransitionActive({ type: 'crossfading', outgoingDeck: mockDeckSnapshot, incomingDeck: mockDeckSnapshotB, plan: mockTransitionPlan, progress: 0.5 })).toBe(true);
    });

    it('returns false for non-transition states', () => {
      expect(isTransitionActive({ type: 'idle' })).toBe(false);
      expect(isTransitionActive({ type: 'playing', activeDeck: mockDeckSnapshot, analysis: DEFAULT_ANALYSIS_SNAPSHOT })).toBe(false);
    });
  });

  describe('getActiveDeck', () => {
    it('returns the active deck when available', () => {
      const deck = getActiveDeck({ type: 'playing', activeDeck: mockDeckSnapshot, analysis: DEFAULT_ANALYSIS_SNAPSHOT });
      expect(deck?.id).toBe('A');
    });

    it('returns incoming deck during crossfade', () => {
      const deck = getActiveDeck({ 
        type: 'crossfading', 
        outgoingDeck: mockDeckSnapshot, 
        incomingDeck: mockDeckSnapshotB, 
        plan: mockTransitionPlan, 
        progress: 0.5 
      });
      expect(deck?.id).toBe('B');
    });

    it('returns null for idle state', () => {
      expect(getActiveDeck({ type: 'idle' })).toBeNull();
    });
  });

  describe('getCrossfadeProgress', () => {
    it('returns progress during crossfade', () => {
      const progress = getCrossfadeProgress({ 
        type: 'crossfading', 
        outgoingDeck: mockDeckSnapshot, 
        incomingDeck: mockDeckSnapshotB, 
        plan: mockTransitionPlan, 
        progress: 0.75 
      });
      expect(progress).toBe(0.75);
    });

    it('returns null for non-crossfading states', () => {
      expect(getCrossfadeProgress({ type: 'idle' })).toBeNull();
      expect(getCrossfadeProgress({ type: 'playing', activeDeck: mockDeckSnapshot, analysis: DEFAULT_ANALYSIS_SNAPSHOT })).toBeNull();
    });
  });
});

describe('Determinism', () => {
  it('produces same output for same input', () => {
    const state: DJState = { type: 'ready', activeDeck: mockDeckSnapshot };
    const event: DJEvent = { type: 'PLAY' };

    const result1 = djReducerSimple(state, event);
    const result2 = djReducerSimple(state, event);

    expect(result1).toEqual(result2);
  });

  it('does not mutate input state', () => {
    const state: DJState = { type: 'ready', activeDeck: mockDeckSnapshot };
    const originalState = { ...state };
    
    djReducer(state, { type: 'PLAY' });
    
    expect(state).toEqual(originalState);
  });
});
