/**
 * Tempo Matching
 * 
 * Pure functions for matching tempo between two tracks.
 * All functions are deterministic: same inputs always produce same outputs.
 */

import type { 
  BeatGrid, 
  TempoConstraints, 
  TempoMatchResult,
  PlaybackRate,
  Normalized,
  DurationMs,
  BPM,
} from '../types';
import type { PhaseAlignment } from './types';
import { getBeatDuration, getGridPosition } from './beatgrid';
import { DEFAULT_TEMPO_CONSTRAINTS } from '../types';

// =============================================================================
// Tempo Ratio Calculation
// =============================================================================

/**
 * Calculate the playback rate needed to match target BPM to source BPM.
 * 
 * @param sourceBpm - BPM of the currently playing track
 * @param targetBpm - BPM of the incoming track
 * @param constraints - Tempo adjustment constraints
 * @returns Playback rate multiplier (e.g., 1.05 = 5% faster)
 */
export function calculatePlaybackRate(
  sourceBpm: BPM,
  targetBpm: BPM,
  constraints: TempoConstraints = DEFAULT_TEMPO_CONSTRAINTS
): PlaybackRate {
  // Handle edge cases
  if (!Number.isFinite(sourceBpm) || sourceBpm <= 0) return 1;
  if (!Number.isFinite(targetBpm) || targetBpm <= 0) return 1;
  
  // Calculate raw ratio
  const rawRate = sourceBpm / targetBpm;
  
  // Handle half/double time detection
  // If the ratio suggests tracks are at very different tempos,
  // try to find a matching relationship
  let rate = rawRate;
  
  if (rawRate > 1.5 && rawRate < 2.5) {
    // Target is roughly half the tempo, double it
    rate = rawRate / 2;
  } else if (rawRate > 0.4 && rawRate < 0.7) {
    // Target is roughly double the tempo, halve it
    rate = rawRate * 2;
  }
  
  // Clamp to constraints
  return Math.max(
    constraints.minRate,
    Math.min(constraints.maxRate, rate)
  );
}

/**
 * Check if tempo matching is feasible within constraints.
 * Returns true if the required playback rate adjustment is within bounds.
 */
export function isTempoMatchFeasible(
  sourceBpm: BPM,
  targetBpm: BPM,
  constraints: TempoConstraints = DEFAULT_TEMPO_CONSTRAINTS
): boolean {
  // Handle edge cases
  if (!Number.isFinite(sourceBpm) || sourceBpm <= 0) return false;
  if (!Number.isFinite(targetBpm) || targetBpm <= 0) return false;
  
  // Calculate raw ratio (before clamping)
  let rawRate = sourceBpm / targetBpm;
  
  // Apply half/double time detection (same logic as calculatePlaybackRate)
  if (rawRate > 1.5 && rawRate < 2.5) {
    rawRate = rawRate / 2;
  } else if (rawRate > 0.4 && rawRate < 0.7) {
    rawRate = rawRate * 2;
  }
  
  // Check if the rate (before clamping) is within constraints
  return rawRate >= constraints.minRate && rawRate <= constraints.maxRate;
}

// =============================================================================
// Phase Alignment
// =============================================================================

/**
 * Calculate the phase offset needed to align two beat grids.
 * 
 * @param sourcePhase - Current phase in the source track (0-1)
 * @param targetPhase - Current phase in the target track (0-1)
 * @param beatDurationMs - Duration of a beat in milliseconds
 * @returns Phase alignment information
 */
export function calculatePhaseOffset(
  sourcePhase: Normalized,
  targetPhase: Normalized,
  beatDurationMs: DurationMs
): PhaseAlignment {
  // Calculate the phase difference (how far apart the beats are)
  let phaseDiff = sourcePhase - targetPhase;
  
  // Normalize to -0.5 to 0.5 (shortest path around the cycle)
  if (phaseDiff > 0.5) phaseDiff -= 1;
  if (phaseDiff < -0.5) phaseDiff += 1;
  
  // Convert to milliseconds
  const offsetMs = phaseDiff * beatDurationMs;
  
  // Quality is highest when phases are already aligned
  const quality = 1 - Math.abs(phaseDiff) * 2;
  
  return {
    offsetMs,
    quality: Math.max(0, quality),
    phaseDifference: Math.abs(phaseDiff),
  };
}

/**
 * Calculate phase alignment between two beat grids at a specific time.
 * 
 * @param sourceGrid - Beat grid of the source track
 * @param targetGrid - Beat grid of the target track
 * @param sourceTimeSec - Current time in the source track
 * @param targetTimeSec - Current time in the target track
 */
export function calculateGridPhaseOffset(
  sourceGrid: BeatGrid,
  targetGrid: BeatGrid,
  sourceTimeSec: number,
  targetTimeSec: number
): PhaseAlignment {
  const sourcePos = getGridPosition(sourceGrid, sourceTimeSec);
  const targetPos = getGridPosition(targetGrid, targetTimeSec);
  
  // Use the source beat duration as reference
  const beatDurationMs = getBeatDuration(sourceGrid) * 1000;
  
  return calculatePhaseOffset(
    sourcePos.beatPhase,
    targetPos.beatPhase,
    beatDurationMs
  );
}

// =============================================================================
// Full Tempo Matching
// =============================================================================

/**
 * Calculate the confidence of a tempo match.
 */
function calculateMatchConfidence(
  sourceGrid: BeatGrid,
  targetGrid: BeatGrid,
  rate: PlaybackRate,
  constraints: TempoConstraints
): Normalized {
  // Start with the product of grid confidences
  let confidence = sourceGrid.confidence * targetGrid.confidence;
  
  // Reduce confidence if rate is at the edge of constraints
  const rateMidpoint = (constraints.minRate + constraints.maxRate) / 2;
  const rateRange = (constraints.maxRate - constraints.minRate) / 2;
  const rateDeviation = Math.abs(rate - rateMidpoint) / rateRange;
  confidence *= (1 - rateDeviation * 0.3);
  
  // Boost confidence if BPMs are already close
  const bpmDiff = Math.abs(sourceGrid.bpm - targetGrid.bpm * rate);
  if (bpmDiff < 1) confidence *= 1.1;
  if (bpmDiff < 0.5) confidence *= 1.05;
  
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Match tempo and phase between two tracks.
 * 
 * This is the main function for beatmatching. It calculates:
 * 1. The playback rate for the target track to match source tempo
 * 2. The phase offset to align beats
 * 3. Confidence in the match
 * 
 * @param source - Beat grid of the currently playing track
 * @param target - Beat grid of the incoming track
 * @param constraints - Tempo adjustment constraints
 * @param sourceTimeSec - Optional: current time in source for phase alignment
 * @param targetTimeSec - Optional: current time in target for phase alignment
 */
export function matchTempo(
  source: BeatGrid,
  target: BeatGrid,
  constraints: TempoConstraints = DEFAULT_TEMPO_CONSTRAINTS,
  sourceTimeSec?: number,
  targetTimeSec?: number
): TempoMatchResult {
  // Calculate playback rate
  const targetPlaybackRate = calculatePlaybackRate(
    source.bpm,
    target.bpm,
    constraints
  );
  
  // Check feasibility
  const feasible = isTempoMatchFeasible(source.bpm, target.bpm, constraints);
  
  // Calculate phase offset if times are provided
  let phaseOffsetMs: DurationMs = 0;
  
  if (sourceTimeSec !== undefined && targetTimeSec !== undefined) {
    // Adjust target grid BPM by the playback rate for accurate phase calculation
    const adjustedTargetGrid: BeatGrid = {
      ...target,
      bpm: target.bpm * targetPlaybackRate,
    };
    
    const phaseAlignment = calculateGridPhaseOffset(
      source,
      adjustedTargetGrid,
      sourceTimeSec,
      targetTimeSec
    );
    
    phaseOffsetMs = phaseAlignment.offsetMs;
  }
  
  // Calculate confidence
  const confidence = calculateMatchConfidence(
    source,
    target,
    targetPlaybackRate,
    constraints
  );
  
  return {
    targetPlaybackRate,
    phaseOffsetMs,
    confidence,
    feasible,
  };
}

/**
 * Snap a time to the nearest beat.
 * 
 * @param grid - Beat grid
 * @param timeSec - Time to snap
 * @param roundUp - If true, always round up to next beat
 */
export function snapToBeat(
  grid: BeatGrid,
  timeSec: number,
  roundUp: boolean = false
): number {
  const pos = getGridPosition(grid, timeSec);
  const beatDuration = getBeatDuration(grid);
  
  if (roundUp || pos.beatPhase > 0.5) {
    // Round up to next beat
    return timeSec + (pos.timeToNextBeat / 1000);
  } else {
    // Round down to current beat
    return timeSec - (pos.timeSinceLastBeat / 1000);
  }
}

/**
 * Snap a time to the nearest bar.
 */
export function snapToBar(
  grid: BeatGrid,
  timeSec: number,
  roundUp: boolean = false
): number {
  const pos = getGridPosition(grid, timeSec);
  const barDuration = getBeatDuration(grid) * grid.beatsPerBar;
  const timeInBar = pos.barPhase * barDuration;
  
  if (roundUp || pos.barPhase > 0.5) {
    // Round up to next bar
    return timeSec + (barDuration - timeInBar);
  } else {
    // Round down to current bar
    return timeSec - timeInBar;
  }
}
