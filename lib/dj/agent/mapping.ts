/**
 * DJ Agent Mapping
 * 
 * Maps high-level agent settings (vibe, intensity) to concrete
 * transition parameters for the DJ engine.
 */

import type { TransitionPlanOptions } from '../engine/types';
import type { EQCurvePreset } from '../eq/types';
import type {
  AgentDJSettings,
  VibeDirection,
  MixIntensity,
  HarmonicMode,
} from './types';

// =============================================================================
// Intensity Mappings
// =============================================================================

/**
 * Map mix intensity to crossfade duration range (in seconds)
 */
export function getIntensityCrossfadeDuration(intensity: MixIntensity): {
  minCrossfadeSec: number;
  maxCrossfadeSec: number;
} {
  switch (intensity) {
    case 'smooth':
      return { minCrossfadeSec: 16, maxCrossfadeSec: 64 };
    case 'aggressive':
      return { minCrossfadeSec: 2, maxCrossfadeSec: 16 };
    case 'normal':
    default:
      return { minCrossfadeSec: 4, maxCrossfadeSec: 32 };
  }
}

/**
 * Map mix intensity to preferred phrase length (in bars)
 */
export function getIntensityPhraseBars(intensity: MixIntensity): number {
  switch (intensity) {
    case 'smooth':
      return 32; // Long, gradual transitions
    case 'aggressive':
      return 8;  // Quick cuts
    case 'normal':
    default:
      return 16; // Standard DJ phrase
  }
}

// =============================================================================
// Vibe Mappings
// =============================================================================

/** Subset of EQ presets that are usable for agent control (excludes 'custom') */
type AgentEQPreset = 'bassSwap' | 'frequencySplit' | 'smooth' | 'highFirst';

/**
 * Get recommended EQ preset based on vibe direction
 */
export function getVibeEQPreset(vibe: VibeDirection): AgentEQPreset {
  switch (vibe) {
    case 'build':
      return 'highFirst'; // Bring in highs first for building energy
    case 'peak':
      return 'bassSwap'; // Classic technique for peak moments
    case 'wind_down':
      return 'smooth';   // Gentle transitions when cooling down
    case 'maintain':
    default:
      return 'bassSwap'; // Safe default
  }
}

/**
 * Get energy preference multiplier based on vibe
 * Used to adjust energy scoring in track selection
 */
export function getVibeEnergyPreference(vibe: VibeDirection): {
  preferHigherEnergy: boolean;
  energyChangeTarget: number; // -1 to +1
} {
  switch (vibe) {
    case 'build':
      return { preferHigherEnergy: true, energyChangeTarget: 0.15 };
    case 'peak':
      return { preferHigherEnergy: true, energyChangeTarget: 0 };
    case 'wind_down':
      return { preferHigherEnergy: false, energyChangeTarget: -0.1 };
    case 'maintain':
    default:
      return { preferHigherEnergy: false, energyChangeTarget: 0 };
  }
}

// =============================================================================
// Harmonic Mode Mappings
// =============================================================================

/**
 * Map harmonic mode to compatibility threshold
 * Returns minimum compatibility score (0-1) for track to be considered mixable
 */
export function getHarmonicThreshold(mode: HarmonicMode): number {
  switch (mode) {
    case 'strict':
      return 0.8; // Only allow very compatible keys
    case 'flexible':
      return 0.5; // Allow moderately compatible keys
    case 'off':
    default:
      return 0;   // Allow any key
  }
}

// =============================================================================
// Complete Settings Mapping
// =============================================================================

/**
 * Convert agent DJ settings to transition plan options
 */
export function mapAgentSettingsToTransitionOptions(
  settings: AgentDJSettings
): TransitionPlanOptions {
  const { minCrossfadeSec, maxCrossfadeSec } = getIntensityCrossfadeDuration(settings.intensity);
  const preferredPhraseBars = settings.transition.phraseBars || getIntensityPhraseBars(settings.intensity);
  
  // Use agent's explicit EQ preset if set (excluding 'custom'), otherwise derive from vibe
  const rawPreset = settings.transition.eqPreset;
  const eqPreset: AgentEQPreset = 
    (rawPreset && rawPreset !== 'custom') ? (rawPreset as AgentEQPreset) : getVibeEQPreset(settings.vibe);
  
  return {
    minCrossfadeSec,
    maxCrossfadeSec,
    preferredPhraseBars,
    eqPreset,
    useHarmonicMatching: settings.harmonicMode !== 'off',
    useTempoMatching: true,
  };
}

/**
 * Get recommended transition timing based on current playback position
 * and agent settings
 */
export function getTransitionTiming(
  currentTimeSec: number,
  trackDurationSec: number,
  barDurationSec: number,
  settings: AgentDJSettings
): {
  shouldTransitionSoon: boolean;
  urgency: 'low' | 'medium' | 'high';
  suggestedStartSec: number | null;
} {
  const { minCrossfadeSec, maxCrossfadeSec } = getIntensityCrossfadeDuration(settings.intensity);
  const phraseBars = settings.transition.phraseBars || getIntensityPhraseBars(settings.intensity);
  const phraseDurationSec = phraseBars * barDurationSec;
  
  // Calculate how much time is left in the track
  const remainingTimeSec = trackDurationSec - currentTimeSec;
  
  // We need at least the crossfade duration plus some buffer
  const minRequiredTime = maxCrossfadeSec + 8;
  
  if (remainingTimeSec < minRequiredTime) {
    // Urgent - we need to transition soon
    return {
      shouldTransitionSoon: true,
      urgency: 'high',
      suggestedStartSec: currentTimeSec + barDurationSec, // Next bar
    };
  }
  
  if (remainingTimeSec < minRequiredTime * 2) {
    // Should plan transition
    return {
      shouldTransitionSoon: true,
      urgency: 'medium',
      suggestedStartSec: Math.ceil((currentTimeSec + phraseDurationSec) / phraseDurationSec) * phraseDurationSec,
    };
  }
  
  // No urgency - can wait for good moment
  return {
    shouldTransitionSoon: false,
    urgency: 'low',
    suggestedStartSec: null,
  };
}

/**
 * Determine if current moment is good for transition based on
 * analysis and agent settings
 */
export function isGoodTransitionMomentForVibe(
  overallEnergy: number,
  bassEnergy: number,
  section: string,
  dropDetected: boolean,
  settings: AgentDJSettings
): boolean {
  const vibe = settings.vibe;
  const intensity = settings.intensity;
  
  // For aggressive mixing, any strong moment works
  if (intensity === 'aggressive') {
    return dropDetected || bassEnergy > 0.6;
  }
  
  // For smooth mixing, prefer breakdowns and low energy moments
  if (intensity === 'smooth') {
    return section === 'breakdown' || overallEnergy < 0.4;
  }
  
  // Normal mixing - depends on vibe
  switch (vibe) {
    case 'build':
      // Transition during build-ups, not peaks
      return section === 'comeup' || (section === 'breakdown' && overallEnergy > 0.3);
    
    case 'peak':
      // Transition at peak moments for maximum impact
      return dropDetected || (section === 'culmination' && bassEnergy > 0.5);
    
    case 'wind_down':
      // Transition during calm moments
      return section === 'breakdown' || overallEnergy < 0.35;
    
    case 'maintain':
    default:
      // Standard DJ logic - breakdowns and post-peak moments
      return section === 'breakdown' || 
             (section === 'culmination' && bassEnergy > 0.55);
  }
}


