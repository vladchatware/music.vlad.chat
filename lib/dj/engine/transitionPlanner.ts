/**
 * Transition Planner
 * 
 * Combines all matchers (tempo, phrase, harmonic, energy) to create
 * optimal transition plans.
 */

import type {
  TransitionPlan,
  BeatBoundary,
  BeatGrid,
  StructureMap,
  EnergyCurve,
  EQCurve,
  HarmonicScore,
  TransitionScore,
  TempoMatchResult,
  CamelotKey,
  AudioTimeSec,
  DurationSec,
  Normalized,
  TimestampMs,
} from '../types';
import type {
  DeckSnapshot,
  TransitionPlanInput,
  TransitionPlanOptions,
} from './types';
import { DEFAULT_TRANSITION_PLAN_OPTIONS } from './types';
import { DEFAULT_TEMPO_CONSTRAINTS, DEFAULT_BEAT_GRID, FALLBACK_BPM } from '../types';

// Import matchers
import { matchTempo, getBarDuration, getNextPhraseBoundary, getBeatAtTime } from '../tempo';
import { getCompatibility, parseKey } from '../harmonic';
import { scoreTransition, getEnergyAtTime } from '../energy';
import { getCurveByPreset } from '../eq';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get effective beat grid (with fallback)
 */
function getEffectiveBeatGrid(deck: DeckSnapshot): BeatGrid {
  if (deck.beatGrid) return deck.beatGrid;
  
  const bpm = deck.track.bpm ?? FALLBACK_BPM;
  return {
    bpm,
    beatsPerBar: 4,
    firstDownbeat: 0,
    confidence: deck.track.bpm ? 0.8 : 0,
  };
}

/**
 * Calculate crossfade duration based on tempo and phrase length
 */
function calculateCrossfadeDuration(
  bpm: number,
  phraseBars: number,
  options: Required<TransitionPlanOptions>
): DurationSec {
  const barDurationSec = (60 / bpm) * 4;
  const idealDuration = phraseBars * barDurationSec;
  
  return Math.max(
    options.minCrossfadeSec,
    Math.min(options.maxCrossfadeSec, idealDuration)
  );
}

/**
 * Find the best beat boundary to start the transition
 */
function findBestBoundary(
  grid: BeatGrid,
  structure: StructureMap | null,
  currentTimeSec: AudioTimeSec,
  crossfadeDurationSec: DurationSec,
  trackDuration: DurationSec,
  phraseBars: number
): BeatBoundary {
  // Get the next phrase boundary
  let boundaryTime = getNextPhraseBoundary(grid, currentTimeSec, phraseBars);
  
  // Ensure we have enough time for the crossfade
  const minBoundary = currentTimeSec + 2; // At least 2 seconds from now
  if (boundaryTime < minBoundary) {
    boundaryTime = getNextPhraseBoundary(grid, boundaryTime + 0.1, phraseBars);
  }
  
  // Ensure we don't exceed track duration
  if (boundaryTime + crossfadeDurationSec > trackDuration) {
    // Fall back to next bar
    boundaryTime = getNextPhraseBoundary(grid, currentTimeSec, 1);
  }
  
  // Calculate bar index
  const beat = getBeatAtTime(grid, boundaryTime);
  const barIndex = Math.floor(beat.index / grid.beatsPerBar);
  
  return {
    timeSec: boundaryTime,
    barIndex,
    isPhraseBoundary: barIndex % phraseBars === 0,
    phraseLength: phraseBars,
  };
}

/**
 * Calculate harmonic compatibility between tracks
 */
function calculateHarmonicScore(
  outgoingTrack: DeckSnapshot['track'],
  incomingTrack: DeckSnapshot['track']
): HarmonicScore {
  const outgoingKey = outgoingTrack.camelotKey ?? 
    (outgoingTrack.keySignature ? parseKey(outgoingTrack.keySignature) : null);
  const incomingKey = incomingTrack.camelotKey ?? 
    (incomingTrack.keySignature ? parseKey(incomingTrack.keySignature) : null);
  
  if (!outgoingKey || !incomingKey) {
    // Unknown keys - neutral compatibility (neither recommended nor discouraged)
    return {
      compatibility: 0.5,
      relationship: 'unknown',
      suggestedPitchShift: 0,
      recommended: false,
    };
  }
  
  return getCompatibility(outgoingKey, incomingKey);
}

/**
 * Calculate energy transition score
 */
function calculateEnergyScore(
  outgoingCurve: EnergyCurve | null,
  incomingCurve: EnergyCurve | null,
  exitTime: AudioTimeSec,
  entryTime: AudioTimeSec
): TransitionScore {
  if (!outgoingCurve || !incomingCurve) {
    // No energy data - assume neutral
    return {
      energyMatch: 0.7,
      momentumMatch: 0.7,
      contrastScore: 0.7,
      overall: 0.7,
    };
  }
  
  return scoreTransition(
    outgoingCurve,
    exitTime,
    incomingCurve,
    entryTime
  );
}

/**
 * Adjust phrase bars based on section type
 */
function getPhraseBarsForSection(
  sectionType: string,
  preferredPhraseBars: number
): number {
  switch (sectionType) {
    case 'intro':
    case 'outro':
      return Math.min(8, preferredPhraseBars);
    case 'breakdown':
      return Math.min(4, preferredPhraseBars);
    case 'drop':
    case 'culmination':
      return preferredPhraseBars; // Use full phrase for high energy sections
    default:
      return preferredPhraseBars;
  }
}

/**
 * Calculate overall plan quality score
 */
function calculatePlanQuality(
  tempoMatch: TempoMatchResult,
  harmonicScore: HarmonicScore,
  energyScore: TransitionScore
): Normalized {
  const weights = {
    tempo: 0.3,
    harmonic: 0.3,
    energy: 0.4,
  };
  
  const tempoQuality = tempoMatch.feasible ? tempoMatch.confidence : 0.3;
  const harmonicQuality = harmonicScore.compatibility;
  const energyQuality = energyScore.overall;
  
  return (
    tempoQuality * weights.tempo +
    harmonicQuality * weights.harmonic +
    energyQuality * weights.energy
  );
}

// =============================================================================
// Main Planning Function
// =============================================================================

/**
 * Create a transition plan between two tracks.
 * 
 * This combines all available analysis (tempo, phrase, harmonic, energy)
 * to create an optimal transition plan.
 * 
 * @param input - Transition planning input (decks, current time, analysis)
 * @param options - Planning options
 * @returns A complete transition plan
 */
export function createTransitionPlan(
  input: TransitionPlanInput,
  options: TransitionPlanOptions = {}
): TransitionPlan {
  const opts = { ...DEFAULT_TRANSITION_PLAN_OPTIONS, ...options };
  const { outgoingDeck, incomingDeck, currentTimeSec, analysis } = input;
  
  // Get effective beat grids
  const outgoingGrid = getEffectiveBeatGrid(outgoingDeck);
  const incomingGrid = getEffectiveBeatGrid(incomingDeck);
  
  // Calculate tempo match
  const tempoMatch = opts.useTempoMatching
    ? matchTempo(
        outgoingGrid,
        incomingGrid,
        DEFAULT_TEMPO_CONSTRAINTS,
        currentTimeSec,
        0 // Start from beginning of incoming track
      )
    : {
        targetPlaybackRate: 1,
        phaseOffsetMs: 0,
        confidence: 1,
        feasible: true,
      };
  
  // Determine phrase length based on current section
  const phraseBars = getPhraseBarsForSection(analysis.section, opts.preferredPhraseBars);
  
  // Calculate crossfade duration
  const crossfadeDurationSec = calculateCrossfadeDuration(
    outgoingGrid.bpm,
    phraseBars,
    opts
  );
  
  // Find the best transition boundary
  const trackDuration = outgoingDeck.track.duration ?? 300; // Default 5 min
  const startBoundary = findBestBoundary(
    outgoingGrid,
    outgoingDeck.structureMap,
    currentTimeSec,
    crossfadeDurationSec,
    trackDuration,
    phraseBars
  );
  
  // Calculate harmonic compatibility
  const harmonicScore = opts.useHarmonicMatching
    ? calculateHarmonicScore(outgoingDeck.track, incomingDeck.track)
    : {
        compatibility: 1,
        relationship: 'same' as const,
        suggestedPitchShift: 0,
        recommended: true,
      };
  
  // Calculate energy score
  const energyScore = calculateEnergyScore(
    outgoingDeck.energyCurve,
    incomingDeck.energyCurve,
    startBoundary.timeSec,
    0 // Entry point in incoming track
  );
  
  // Create EQ curve
  const eqCurve = getCurveByPreset(opts.eqPreset, {
    durationSec: crossfadeDurationSec,
    bassSwapPoint: 0.5,
  });
  
  // Calculate overall quality
  const quality = calculatePlanQuality(tempoMatch, harmonicScore, energyScore);
  
  return {
    startBoundary,
    crossfadeDurationSec,
    tempoAdjustment: tempoMatch,
    eqCurve,
    harmonicScore,
    energyScore,
    quality,
    createdAt: performance.now(),
  };
}

/**
 * Check if it's a good time to start a transition.
 * 
 * Returns true when the current position is within the tolerance window
 * around the planned boundary. The tolerance is symmetric, meaning:
 * - Positions up to `toleranceSec` BEFORE the boundary are accepted (early start)
 * - Positions up to `toleranceSec` AFTER the boundary are accepted (late start)
 * 
 * For example, with toleranceSec=0.25 and boundary at 60s:
 * - Returns true for positions 59.75s to 60.25s
 * - Returns false for positions < 59.75s or > 60.25s
 * 
 * @param currentTimeSec - Current playback position
 * @param plan - The transition plan containing the target boundary
 * @param toleranceSec - Symmetric tolerance window around the boundary (default: 0.25s)
 * @returns true if current position is within tolerance of the planned boundary
 */
export function isGoodTransitionMoment(
  currentTimeSec: AudioTimeSec,
  plan: TransitionPlan,
  toleranceSec: number = 0.25
): boolean {
  const diff = currentTimeSec - plan.startBoundary.timeSec;
  return diff >= -toleranceSec && diff <= toleranceSec;
}

/**
 * Update a transition plan with new timing.
 * 
 * Call this when the current time has passed the planned boundary
 * without starting the transition.
 */
export function updateTransitionPlan(
  plan: TransitionPlan,
  input: TransitionPlanInput,
  options: TransitionPlanOptions = {}
): TransitionPlan {
  // If we're past the planned boundary, create a new plan
  if (input.currentTimeSec > plan.startBoundary.timeSec) {
    return createTransitionPlan(input, options);
  }
  
  // Otherwise, keep the current plan
  return plan;
}

/**
 * Calculate the progress of a crossfade.
 * 
 * @param startTimeSec - When the crossfade started
 * @param currentTimeSec - Current time
 * @param durationSec - Total duration of the crossfade
 */
export function calculateCrossfadeProgress(
  startTimeSec: AudioTimeSec,
  currentTimeSec: AudioTimeSec,
  durationSec: DurationSec
): Normalized {
  if (durationSec <= 0) return 1;
  
  const elapsed = currentTimeSec - startTimeSec;
  return Math.max(0, Math.min(1, elapsed / durationSec));
}

/**
 * Get recommended entry point in the incoming track.
 * 
 * Considers:
 * - Phrase boundaries
 * - Energy levels
 * - Avoiding intros (if desired)
 */
export function getRecommendedEntryPoint(
  incomingDeck: DeckSnapshot,
  skipIntro: boolean = true
): AudioTimeSec {
  const structure = incomingDeck.structureMap;
  const grid = getEffectiveBeatGrid(incomingDeck);
  
  if (!structure || structure.sections.length === 0) {
    // No structure data - use a safe default
    return skipIntro ? 30 : 0; // Skip 30 seconds or start from beginning
  }
  
  if (!skipIntro) {
    return 0;
  }
  
  // Find the first non-intro section
  for (const section of structure.sections) {
    if (section.type !== 'intro') {
      // Snap to phrase boundary
      return getNextPhraseBoundary(grid, section.startTime - 0.1, 4);
    }
  }
  
  // All sections are intro (unlikely) - start at 25%
  const trackDuration = incomingDeck.track.duration ?? 180;
  return getNextPhraseBoundary(grid, trackDuration * 0.25, 4);
}
