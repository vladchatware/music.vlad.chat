/**
 * DJ Agent Defaults
 * 
 * Default values for agent-controlled DJ settings.
 */

import type {
  AgentDJSettings,
  AgentEQSettings,
  AgentFilterSettings,
  AgentTransitionSettings,
} from './types';

/**
 * Default EQ settings (flat/unity gain)
 */
export const DEFAULT_AGENT_EQ: AgentEQSettings = {
  low: 1,
  mid: 1,
  high: 1,
};

/**
 * Default filter settings (disabled)
 */
export const DEFAULT_AGENT_FILTER: AgentFilterSettings = {
  type: 'lowpass',
  frequency: 20000,
  resonance: 0.7,
  enabled: false,
};

/**
 * Default transition settings
 */
export const DEFAULT_AGENT_TRANSITION: AgentTransitionSettings = {
  eqPreset: 'bassSwap',
  durationBars: 16,
  phraseBars: 16,
};

/**
 * Complete default agent settings
 */
export const DEFAULT_AGENT_SETTINGS: AgentDJSettings = {
  eq: {
    deckA: { ...DEFAULT_AGENT_EQ },
    deckB: { ...DEFAULT_AGENT_EQ },
  },
  filter: {
    deckA: { ...DEFAULT_AGENT_FILTER },
    deckB: { ...DEFAULT_AGENT_FILTER },
  },
  transition: { ...DEFAULT_AGENT_TRANSITION },
  vibe: 'maintain',
  intensity: 'normal',
  harmonicMode: 'flexible',
  tempoAdjustment: 0,
};


