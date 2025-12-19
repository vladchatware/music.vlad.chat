/**
 * DJ Engine State Machine
 * 
 * A deterministic state machine for managing DJ playback state.
 * All state transitions are pure functions: same input always produces same output.
 */

import type {
  DJState,
  DJEvent,
  DeckSnapshot,
  StateTransitionResult,
  SideEffect,
} from './types';
import { DEFAULT_ANALYSIS_SNAPSHOT } from './types';

// =============================================================================
// Initial State
// =============================================================================

/**
 * Get the initial DJ state.
 */
export function getInitialDJState(): DJState {
  return { type: 'idle' };
}

// =============================================================================
// State Guards (Type Predicates)
// =============================================================================

export function isIdle(state: DJState): state is { type: 'idle' } {
  return state.type === 'idle';
}

export function isLoading(state: DJState): state is { type: 'loading'; trackId: number; deck: 'A' | 'B' } {
  return state.type === 'loading';
}

export function isReady(state: DJState): state is { type: 'ready'; activeDeck: DeckSnapshot } {
  return state.type === 'ready';
}

export function isPlaying(state: DJState): state is { type: 'playing'; activeDeck: DeckSnapshot; analysis: any } {
  return state.type === 'playing';
}

export function isCueing(state: DJState): state is { type: 'cueing'; activeDeck: DeckSnapshot; cueDeck: DeckSnapshot; analysis: any } {
  return state.type === 'cueing';
}

export function isPlanned(state: DJState): state is { type: 'planned'; activeDeck: DeckSnapshot; cueDeck: DeckSnapshot; plan: any; analysis: any } {
  return state.type === 'planned';
}

export function isCrossfading(state: DJState): state is { type: 'crossfading'; outgoingDeck: DeckSnapshot; incomingDeck: DeckSnapshot; plan: any; progress: number } {
  return state.type === 'crossfading';
}

export function isPaused(state: DJState): state is { type: 'paused'; activeDeck: DeckSnapshot } {
  return state.type === 'paused';
}

// =============================================================================
// State Transition Helpers
// =============================================================================

/**
 * Create a transition result with no side effects.
 */
function noEffects(state: DJState): StateTransitionResult {
  return { state, sideEffects: [] };
}

/**
 * Create a transition result with side effects.
 */
function withEffects(state: DJState, sideEffects: SideEffect[]): StateTransitionResult {
  return { state, sideEffects };
}

/**
 * Get the opposite deck ID.
 */
function getOtherDeck(deck: 'A' | 'B'): 'A' | 'B' {
  return deck === 'A' ? 'B' : 'A';
}

// =============================================================================
// Event Handlers (Per State)
// =============================================================================

function handleIdleEvent(state: { type: 'idle' }, event: DJEvent): StateTransitionResult {
  switch (event.type) {
    case 'LOAD_TRACK': {
      const deck = event.deck ?? 'A';
      return withEffects(
        { type: 'loading', trackId: event.trackId, deck },
        [{ type: 'LOAD_AUDIO', trackId: event.trackId, deck }]
      );
    }
    case 'RESET':
      return noEffects(state);
    default:
      return noEffects(state);
  }
}

function handleLoadingEvent(
  state: { type: 'loading'; trackId: number; deck: 'A' | 'B' },
  event: DJEvent
): StateTransitionResult {
  switch (event.type) {
    case 'TRACK_LOADED':
      return noEffects({ type: 'ready', activeDeck: event.deck });
    case 'TRACK_LOAD_FAILED':
      console.error('Track load failed:', event.error);
      return noEffects({ type: 'idle' });
    case 'RESET':
      return withEffects({ type: 'idle' }, [{ type: 'RESET_ALL' }]);
    default:
      return noEffects(state);
  }
}

function handleReadyEvent(
  state: { type: 'ready'; activeDeck: DeckSnapshot },
  event: DJEvent
): StateTransitionResult {
  switch (event.type) {
    case 'PLAY':
      return withEffects(
        { 
          type: 'playing', 
          activeDeck: state.activeDeck, 
          analysis: DEFAULT_ANALYSIS_SNAPSHOT 
        },
        [{ type: 'PLAY_DECK', deck: state.activeDeck.id }]
      );
    case 'LOAD_TRACK': {
      const deck = event.deck ?? state.activeDeck.id;
      return withEffects(
        { type: 'loading', trackId: event.trackId, deck },
        [{ type: 'LOAD_AUDIO', trackId: event.trackId, deck }]
      );
    }
    case 'RESET':
      return withEffects({ type: 'idle' }, [{ type: 'RESET_ALL' }]);
    default:
      return noEffects(state);
  }
}

function handlePlayingEvent(
  state: { type: 'playing'; activeDeck: DeckSnapshot; analysis: any },
  event: DJEvent
): StateTransitionResult {
  switch (event.type) {
    case 'PAUSE':
      return withEffects(
        { type: 'paused', activeDeck: state.activeDeck },
        [{ type: 'PAUSE_DECK', deck: state.activeDeck.id }]
      );
    case 'SEEK':
      return withEffects(
        state,
        [{ type: 'SEEK_DECK', deck: state.activeDeck.id, positionSec: event.positionSec }]
      );
    case 'CUE_TRACK': {
      const cueDeck = getOtherDeck(state.activeDeck.id);
      return withEffects(
        state, // Stay in playing while loading
        [{ type: 'LOAD_AUDIO', trackId: event.trackId, deck: cueDeck }]
      );
    }
    case 'CUE_FAILED':
      // Cue failed while playing - log and stay in playing state
      console.error('Cue failed:', event.error);
      return noEffects(state);
    case 'CUE_READY':
      return noEffects({
        type: 'cueing',
        activeDeck: state.activeDeck,
        cueDeck: event.deck,
        analysis: state.analysis,
      });
    case 'ANALYSIS_UPDATE':
      return noEffects({
        ...state,
        analysis: event.analysis,
      });
    case 'RESET':
      return withEffects({ type: 'idle' }, [{ type: 'RESET_ALL' }]);
    default:
      return noEffects(state);
  }
}

function handleCueingEvent(
  state: { type: 'cueing'; activeDeck: DeckSnapshot; cueDeck: DeckSnapshot; analysis: any },
  event: DJEvent
): StateTransitionResult {
  switch (event.type) {
    case 'PAUSE':
      return withEffects(
        { type: 'paused', activeDeck: state.activeDeck },
        [{ type: 'PAUSE_DECK', deck: state.activeDeck.id }]
      );
    case 'PLAN_TRANSITION':
      return noEffects({
        type: 'planned',
        activeDeck: state.activeDeck,
        cueDeck: state.cueDeck,
        plan: event.plan,
        analysis: state.analysis,
      });
    case 'CANCEL_TRANSITION':
      return noEffects({
        type: 'playing',
        activeDeck: state.activeDeck,
        analysis: state.analysis,
      });
    case 'ANALYSIS_UPDATE':
      return noEffects({
        ...state,
        analysis: event.analysis,
      });
    case 'RESET':
      return withEffects({ type: 'idle' }, [{ type: 'RESET_ALL' }]);
    default:
      return noEffects(state);
  }
}

function handlePlannedEvent(
  state: { type: 'planned'; activeDeck: DeckSnapshot; cueDeck: DeckSnapshot; plan: any; analysis: any },
  event: DJEvent
): StateTransitionResult {
  switch (event.type) {
    case 'PAUSE':
      return withEffects(
        { type: 'paused', activeDeck: state.activeDeck },
        [{ type: 'PAUSE_DECK', deck: state.activeDeck.id }]
      );
    case 'START_CROSSFADE':
      return withEffects(
        {
          type: 'crossfading',
          outgoingDeck: state.activeDeck,
          incomingDeck: state.cueDeck,
          plan: state.plan,
          progress: 0,
        },
        [
          { type: 'PLAY_DECK', deck: state.cueDeck.id },
          { type: 'START_CROSSFADE_AUTOMATION', plan: state.plan },
        ]
      );
    case 'PLAN_TRANSITION':
      // Update the plan
      return noEffects({
        ...state,
        plan: event.plan,
      });
    case 'CANCEL_TRANSITION':
      return noEffects({
        type: 'playing',
        activeDeck: state.activeDeck,
        analysis: state.analysis,
      });
    case 'ANALYSIS_UPDATE':
      return noEffects({
        ...state,
        analysis: event.analysis,
      });
    case 'RESET':
      return withEffects({ type: 'idle' }, [{ type: 'RESET_ALL' }]);
    default:
      return noEffects(state);
  }
}

function handleCrossfadingEvent(
  state: { type: 'crossfading'; outgoingDeck: DeckSnapshot; incomingDeck: DeckSnapshot; plan: any; progress: number },
  event: DJEvent
): StateTransitionResult {
  switch (event.type) {
    case 'CROSSFADE_TICK':
      return noEffects({
        ...state,
        progress: event.progress,
      });
    case 'CROSSFADE_COMPLETE':
      return withEffects(
        {
          type: 'playing',
          activeDeck: state.incomingDeck,
          analysis: DEFAULT_ANALYSIS_SNAPSHOT,
        },
        [{ type: 'STOP_DECK', deck: state.outgoingDeck.id }]
      );
    case 'CANCEL_TRANSITION':
      // This is tricky during crossfade - we might need to reverse
      // For now, just continue to completion
      return noEffects(state);
    case 'RESET':
      return withEffects({ type: 'idle' }, [{ type: 'RESET_ALL' }]);
    default:
      return noEffects(state);
  }
}

function handlePausedEvent(
  state: { type: 'paused'; activeDeck: DeckSnapshot },
  event: DJEvent
): StateTransitionResult {
  switch (event.type) {
    case 'PLAY':
      return withEffects(
        {
          type: 'playing',
          activeDeck: state.activeDeck,
          analysis: DEFAULT_ANALYSIS_SNAPSHOT,
        },
        [{ type: 'PLAY_DECK', deck: state.activeDeck.id }]
      );
    case 'SEEK':
      return withEffects(
        state,
        [{ type: 'SEEK_DECK', deck: state.activeDeck.id, positionSec: event.positionSec }]
      );
    case 'LOAD_TRACK': {
      const deck = event.deck ?? state.activeDeck.id;
      return withEffects(
        { type: 'loading', trackId: event.trackId, deck },
        [{ type: 'LOAD_AUDIO', trackId: event.trackId, deck }]
      );
    }
    case 'RESET':
      return withEffects({ type: 'idle' }, [{ type: 'RESET_ALL' }]);
    default:
      return noEffects(state);
  }
}

// =============================================================================
// Main Reducer
// =============================================================================

/**
 * Pure state machine reducer.
 * 
 * Given the current state and an event, produces the next state
 * and any side effects that should be executed.
 * 
 * This function is deterministic: same inputs always produce same outputs.
 */
export function djReducer(state: DJState, event: DJEvent): StateTransitionResult {
  switch (state.type) {
    case 'idle':
      return handleIdleEvent(state, event);
    case 'loading':
      return handleLoadingEvent(state, event);
    case 'ready':
      return handleReadyEvent(state, event);
    case 'playing':
      return handlePlayingEvent(state, event);
    case 'cueing':
      return handleCueingEvent(state, event);
    case 'planned':
      return handlePlannedEvent(state, event);
    case 'crossfading':
      return handleCrossfadingEvent(state, event);
    case 'paused':
      return handlePausedEvent(state, event);
    default: {
      // Exhaustive check
      const _exhaustive: never = state;
      return noEffects(_exhaustive);
    }
  }
}

/**
 * Simplified reducer that only returns the new state (no side effects).
 * Useful for testing or when side effects are handled elsewhere.
 */
export function djReducerSimple(state: DJState, event: DJEvent): DJState {
  return djReducer(state, event).state;
}

// =============================================================================
// State Queries
// =============================================================================

/**
 * Check if a track is currently playing.
 */
export function isTrackPlaying(state: DJState): boolean {
  return state.type === 'playing' || 
         state.type === 'cueing' || 
         state.type === 'planned' || 
         state.type === 'crossfading';
}

/**
 * Check if a transition is in progress or planned.
 */
export function isTransitionActive(state: DJState): boolean {
  return state.type === 'cueing' || 
         state.type === 'planned' || 
         state.type === 'crossfading';
}

/**
 * Get the currently active deck snapshot (if any).
 */
export function getActiveDeck(state: DJState): DeckSnapshot | null {
  switch (state.type) {
    case 'ready':
    case 'playing':
    case 'cueing':
    case 'planned':
    case 'paused':
      return state.activeDeck;
    case 'crossfading':
      return state.incomingDeck; // The incoming deck is becoming active
    default:
      return null;
  }
}

/**
 * Get the current analysis snapshot (if any).
 */
export function getCurrentAnalysis(state: DJState): any | null {
  switch (state.type) {
    case 'playing':
    case 'cueing':
    case 'planned':
      return state.analysis;
    default:
      return null;
  }
}

/**
 * Get the current transition plan (if any).
 */
export function getCurrentPlan(state: DJState): any | null {
  switch (state.type) {
    case 'planned':
    case 'crossfading':
      return state.plan;
    default:
      return null;
  }
}

/**
 * Get the crossfade progress (0-1, or null if not crossfading).
 */
export function getCrossfadeProgress(state: DJState): number | null {
  if (state.type === 'crossfading') {
    return state.progress;
  }
  return null;
}
