/**
 * DJ Agent Types
 * 
 * Types for AI agent-controlled DJ settings.
 * These settings allow the AI to control mixing parameters
 * beyond just track selection.
 */

import type { Normalized } from '../types';
import type { EQCurvePreset } from '../eq/types';

// =============================================================================
// EQ Settings
// =============================================================================

/**
 * Agent-controlled EQ settings for a single deck
 */
export interface AgentEQSettings {
  /** Low frequencies: 20-250 Hz (0 = cut, 1 = unity) */
  readonly low: Normalized;
  /** Mid frequencies: 250-4000 Hz (0 = cut, 1 = unity) */
  readonly mid: Normalized;
  /** High frequencies: 4000-20000 Hz (0 = cut, 1 = unity) */
  readonly high: Normalized;
}

/**
 * Target deck for EQ adjustments
 */
export type DeckTarget = 'active' | 'cued' | 'A' | 'B';

// =============================================================================
// Filter Settings
// =============================================================================

/**
 * Filter type for sweep effects
 */
export type FilterType = 'highpass' | 'lowpass';

/**
 * Agent-controlled filter settings
 */
export interface AgentFilterSettings {
  /** Filter type */
  readonly type: FilterType;
  /** Cutoff frequency in Hz (20-20000) */
  readonly frequency: number;
  /** Resonance/Q factor (0.1-20) */
  readonly resonance: number;
  /** Whether the filter is active */
  readonly enabled: boolean;
}

// =============================================================================
// Transition Settings
// =============================================================================

/**
 * Agent-controlled transition style settings
 */
export interface AgentTransitionSettings {
  /** EQ curve preset to use during transition */
  readonly eqPreset: EQCurvePreset;
  /** Duration of crossfade in bars (4, 8, 16, 32, 64) */
  readonly durationBars: number;
  /** Phrase alignment boundary in bars */
  readonly phraseBars: number;
}

// =============================================================================
// Vibe & Energy Settings
// =============================================================================

/**
 * Energy trajectory direction for the set
 */
export type VibeDirection = 
  | 'build'      // Increasing intensity over time
  | 'maintain'   // Keep current energy level
  | 'wind_down'  // Decreasing intensity, cooling off
  | 'peak';      // Maximum energy, climax of the set

/**
 * How dramatic/aggressive transitions should be
 */
export type MixIntensity = 
  | 'smooth'     // Long, subtle transitions (32+ bars)
  | 'normal'     // Standard DJ transitions (16 bars)
  | 'aggressive'; // Quick, dramatic cuts (4-8 bars)

/**
 * How strictly to enforce harmonic (key) matching
 */
export type HarmonicMode = 
  | 'strict'   // Only allow compatible keys (Camelot +/-1)
  | 'flexible' // Prefer compatible but allow others
  | 'off';     // Ignore key compatibility

// =============================================================================
// Combined Agent Settings
// =============================================================================

/**
 * Complete agent DJ settings state
 */
export interface AgentDJSettings {
  /** EQ settings per deck */
  readonly eq: {
    readonly deckA: AgentEQSettings;
    readonly deckB: AgentEQSettings;
  };
  /** Filter settings per deck */
  readonly filter: {
    readonly deckA: AgentFilterSettings;
    readonly deckB: AgentFilterSettings;
  };
  /** Transition style configuration */
  readonly transition: AgentTransitionSettings;
  /** Energy trajectory */
  readonly vibe: VibeDirection;
  /** Transition aggressiveness */
  readonly intensity: MixIntensity;
  /** Key matching enforcement */
  readonly harmonicMode: HarmonicMode;
  /** Manual tempo adjustment (-0.08 to +0.08) */
  readonly tempoAdjustment: number;
}

// =============================================================================
// Tool Input Types (for AI agent tool calls)
// =============================================================================

/**
 * Input for setEQ tool
 */
export interface SetEQInput {
  readonly deck: DeckTarget;
  readonly low?: Normalized;
  readonly mid?: Normalized;
  readonly high?: Normalized;
}

/**
 * Input for setFilter tool
 */
export interface SetFilterInput {
  readonly deck: DeckTarget;
  readonly type: FilterType;
  readonly frequency: number;
  readonly resonance?: number;
  readonly enabled?: boolean;
}

/**
 * Input for setTransitionStyle tool
 */
export interface SetTransitionStyleInput {
  readonly preset?: EQCurvePreset;
  readonly durationBars?: number;
  readonly phraseBars?: number;
}

/**
 * Input for setVibe tool
 */
export interface SetVibeInput {
  readonly direction: VibeDirection;
}

/**
 * Input for setMixIntensity tool
 */
export interface SetMixIntensityInput {
  readonly level: MixIntensity;
}

/**
 * Input for setHarmonicMode tool
 */
export interface SetHarmonicModeInput {
  readonly mode: HarmonicMode;
}

/**
 * Input for setTempo tool
 */
export interface SetTempoInput {
  /** Tempo adjustment as percentage (-8 to +8) */
  readonly adjustment: number;
}


