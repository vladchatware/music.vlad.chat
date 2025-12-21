/**
 * DJ Agent Store
 * 
 * Zustand store for AI agent-controlled DJ settings.
 * This store is separate from the main music player store
 * to keep agent controls isolated and easily testable.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type {
  AgentDJSettings,
  AgentEQSettings,
  AgentFilterSettings,
  AgentTransitionSettings,
  DeckTarget,
  FilterType,
  VibeDirection,
  MixIntensity,
  HarmonicMode,
} from './types';
import type { EQCurvePreset } from '../eq/types';
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_AGENT_EQ,
  DEFAULT_AGENT_FILTER,
} from './defaults';

// =============================================================================
// Store Types
// =============================================================================

export interface AgentDJStoreActions {
  /**
   * Set EQ band values for a deck
   */
  setEQ: (deck: DeckTarget, bands: Partial<AgentEQSettings>) => void;
  
  /**
   * Set filter settings for a deck
   */
  setFilter: (deck: DeckTarget, settings: Partial<AgentFilterSettings>) => void;
  
  /**
   * Set transition style settings
   */
  setTransitionStyle: (settings: Partial<AgentTransitionSettings>) => void;
  
  /**
   * Set the vibe/energy direction
   */
  setVibe: (direction: VibeDirection) => void;
  
  /**
   * Set mix intensity (how aggressive transitions are)
   */
  setMixIntensity: (level: MixIntensity) => void;
  
  /**
   * Set harmonic mode (key matching strictness)
   */
  setHarmonicMode: (mode: HarmonicMode) => void;
  
  /**
   * Set tempo adjustment (-0.08 to +0.08)
   */
  setTempoAdjustment: (adjustment: number) => void;
  
  /**
   * Reset all settings to defaults
   */
  reset: () => void;
  
  /**
   * Reset EQ for a specific deck
   */
  resetDeckEQ: (deck: DeckTarget) => void;
}

export interface AgentDJStore {
  settings: AgentDJSettings;
  actions: AgentDJStoreActions;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolve deck target to actual deck ID
 */
function resolveDeck(target: DeckTarget, activeDeck: 'A' | 'B' = 'A'): 'A' | 'B' {
  if (target === 'A' || target === 'B') return target;
  if (target === 'active') return activeDeck;
  // 'cued' is the opposite of active
  return activeDeck === 'A' ? 'B' : 'A';
}

/**
 * Clamp a value between 0 and 1
 */
function clampNormalized(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Clamp tempo adjustment to valid range
 */
function clampTempo(value: number): number {
  return Math.max(-0.08, Math.min(0.08, value));
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useAgentDJStore = create<AgentDJStore>()(
  subscribeWithSelector((set, get) => ({
    settings: { ...DEFAULT_AGENT_SETTINGS },
    
    actions: {
      setEQ: (deck, bands) => {
        const resolvedDeck = resolveDeck(deck);
        const deckKey = resolvedDeck === 'A' ? 'deckA' : 'deckB';
        
        set((state) => ({
          settings: {
            ...state.settings,
            eq: {
              ...state.settings.eq,
              [deckKey]: {
                ...state.settings.eq[deckKey],
                ...(bands.low !== undefined && { low: clampNormalized(bands.low) }),
                ...(bands.mid !== undefined && { mid: clampNormalized(bands.mid) }),
                ...(bands.high !== undefined && { high: clampNormalized(bands.high) }),
              },
            },
          },
        }));
      },
      
      setFilter: (deck, settings) => {
        const resolvedDeck = resolveDeck(deck);
        const deckKey = resolvedDeck === 'A' ? 'deckA' : 'deckB';
        
        set((state) => ({
          settings: {
            ...state.settings,
            filter: {
              ...state.settings.filter,
              [deckKey]: {
                ...state.settings.filter[deckKey],
                ...settings,
                // Clamp frequency to valid audio range
                ...(settings.frequency !== undefined && {
                  frequency: Math.max(20, Math.min(20000, settings.frequency)),
                }),
                // Clamp resonance
                ...(settings.resonance !== undefined && {
                  resonance: Math.max(0.1, Math.min(20, settings.resonance)),
                }),
              },
            },
          },
        }));
      },
      
      setTransitionStyle: (settings) => {
        set((state) => ({
          settings: {
            ...state.settings,
            transition: {
              ...state.settings.transition,
              ...settings,
              // Clamp duration bars to valid values
              ...(settings.durationBars !== undefined && {
                durationBars: Math.max(4, Math.min(64, settings.durationBars)),
              }),
              // Clamp phrase bars
              ...(settings.phraseBars !== undefined && {
                phraseBars: Math.max(1, Math.min(32, settings.phraseBars)),
              }),
            },
          },
        }));
      },
      
      setVibe: (direction) => {
        set((state) => ({
          settings: {
            ...state.settings,
            vibe: direction,
          },
        }));
      },
      
      setMixIntensity: (level) => {
        set((state) => ({
          settings: {
            ...state.settings,
            intensity: level,
          },
        }));
      },
      
      setHarmonicMode: (mode) => {
        set((state) => ({
          settings: {
            ...state.settings,
            harmonicMode: mode,
          },
        }));
      },
      
      setTempoAdjustment: (adjustment) => {
        set((state) => ({
          settings: {
            ...state.settings,
            tempoAdjustment: clampTempo(adjustment / 100), // Convert from percentage
          },
        }));
      },
      
      reset: () => {
        set({ settings: { ...DEFAULT_AGENT_SETTINGS } });
      },
      
      resetDeckEQ: (deck) => {
        const resolvedDeck = resolveDeck(deck);
        const deckKey = resolvedDeck === 'A' ? 'deckA' : 'deckB';
        
        set((state) => ({
          settings: {
            ...state.settings,
            eq: {
              ...state.settings.eq,
              [deckKey]: { ...DEFAULT_AGENT_EQ },
            },
            filter: {
              ...state.settings.filter,
              [deckKey]: { ...DEFAULT_AGENT_FILTER },
            },
          },
        }));
      },
    },
  }))
);

// =============================================================================
// Selectors
// =============================================================================

/**
 * Get current vibe direction
 */
export const selectVibe = (state: AgentDJStore) => state.settings.vibe;

/**
 * Get current mix intensity
 */
export const selectIntensity = (state: AgentDJStore) => state.settings.intensity;

/**
 * Get transition settings
 */
export const selectTransition = (state: AgentDJStore) => state.settings.transition;

/**
 * Get EQ settings for a specific deck
 */
export const selectDeckEQ = (deck: 'A' | 'B') => (state: AgentDJStore) =>
  deck === 'A' ? state.settings.eq.deckA : state.settings.eq.deckB;

/**
 * Get filter settings for a specific deck
 */
export const selectDeckFilter = (deck: 'A' | 'B') => (state: AgentDJStore) =>
  deck === 'A' ? state.settings.filter.deckA : state.settings.filter.deckB;


