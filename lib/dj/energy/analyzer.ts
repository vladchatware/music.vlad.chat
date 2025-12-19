/**
 * Energy Analyzer
 * 
 * Functions for analyzing energy curves and scoring transitions.
 */

import type { 
  EnergyCurve, 
  TransitionScore,
  AudioTimeSec,
  DurationSec,
  Normalized,
} from '../types';
import type { 
  EnergyMomentum,
  EnergyAnalysisOptions,
  TransitionScoringOptions,
  TransitionCandidate,
} from './types';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_OUTPUT_SAMPLE_RATE = 10; // 10 samples per second
const DEFAULT_WINDOW_SEC = 0.5;
const DEFAULT_SMOOTHING = 0.3;

const DEFAULT_ENERGY_WEIGHT = 0.4;
const DEFAULT_MOMENTUM_WEIGHT = 0.3;
const DEFAULT_CONTRAST_WEIGHT = 0.3;

// =============================================================================
// Energy Curve Construction
// =============================================================================

/**
 * Create an energy curve from raw FFT data or audio analysis.
 * 
 * @param samples - Raw energy samples (normalized 0-1)
 * @param inputSampleRate - Sample rate of the input data
 * @param duration - Track duration in seconds
 * @param options - Analysis options
 */
export function analyzeEnergy(
  samples: Float32Array | number[],
  inputSampleRate: number,
  duration: DurationSec,
  options: EnergyAnalysisOptions = {}
): EnergyCurve {
  const {
    outputSampleRate = DEFAULT_OUTPUT_SAMPLE_RATE,
    windowSec = DEFAULT_WINDOW_SEC,
    smoothing = DEFAULT_SMOOTHING,
  } = options;
  
  // Resample to output rate
  const outputLength = Math.ceil(duration * outputSampleRate);
  const outputSamples = new Float32Array(outputLength);
  const windowSamples = Math.ceil(windowSec * inputSampleRate);
  
  for (let i = 0; i < outputLength; i++) {
    const time = i / outputSampleRate;
    const inputIdx = Math.floor(time * inputSampleRate);
    
    // Calculate windowed average
    let sum = 0;
    let count = 0;
    const halfWindow = Math.floor(windowSamples / 2);
    
    for (let j = inputIdx - halfWindow; j <= inputIdx + halfWindow; j++) {
      if (j >= 0 && j < samples.length) {
        sum += samples[j];
        count++;
      }
    }
    
    outputSamples[i] = count > 0 ? sum / count : 0;
  }
  
  // Apply smoothing
  if (smoothing > 0) {
    for (let i = 1; i < outputLength; i++) {
      outputSamples[i] = outputSamples[i - 1] * smoothing + outputSamples[i] * (1 - smoothing);
    }
  }
  
  // Detect peaks and valleys
  const peaks: number[] = [];
  const valleys: number[] = [];
  
  for (let i = 1; i < outputLength - 1; i++) {
    const prev = outputSamples[i - 1];
    const curr = outputSamples[i];
    const next = outputSamples[i + 1];
    
    // Peak: higher than neighbors by at least 0.05
    if (curr > prev + 0.05 && curr > next + 0.05 && curr > 0.3) {
      peaks.push(i);
    }
    // Valley: lower than neighbors by at least 0.05
    if (curr < prev - 0.05 && curr < next - 0.05 && curr < 0.7) {
      valleys.push(i);
    }
  }
  
  return {
    samples: outputSamples,
    sampleRate: outputSampleRate,
    peaks,
    valleys,
    duration,
  };
}

/**
 * Get energy value at a specific time.
 */
export function getEnergyAtTime(curve: EnergyCurve, timeSec: AudioTimeSec): Normalized {
  const idx = Math.floor(timeSec * curve.sampleRate);
  if (idx < 0) return curve.samples[0] ?? 0;
  if (idx >= curve.samples.length) return curve.samples[curve.samples.length - 1] ?? 0;
  return curve.samples[idx];
}

/**
 * Get average energy in a time range.
 */
export function getAverageEnergyInRange(
  curve: EnergyCurve,
  startSec: AudioTimeSec,
  endSec: AudioTimeSec
): Normalized {
  const startIdx = Math.max(0, Math.floor(startSec * curve.sampleRate));
  const endIdx = Math.min(curve.samples.length - 1, Math.floor(endSec * curve.sampleRate));
  
  if (startIdx >= endIdx) return getEnergyAtTime(curve, startSec);
  
  let sum = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    sum += curve.samples[i];
  }
  
  return sum / (endIdx - startIdx + 1);
}

// =============================================================================
// Energy Momentum
// =============================================================================

/**
 * Calculate energy momentum at a specific time.
 * 
 * @param curve - Energy curve
 * @param timeSec - Current time
 * @param lookbackSec - How far back to look for slope calculation
 */
export function getEnergyMomentum(
  curve: EnergyCurve,
  timeSec: AudioTimeSec,
  lookbackSec: DurationSec = 2
): EnergyMomentum {
  const currentEnergy = getEnergyAtTime(curve, timeSec);
  const pastEnergy = getEnergyAtTime(curve, timeSec - lookbackSec);
  
  const slope = (currentEnergy - pastEnergy) / lookbackSec;
  const magnitude = Math.min(1, Math.abs(slope) * 5); // Normalize to 0-1
  
  let direction: EnergyMomentum['direction'];
  if (slope > 0.02) {
    direction = 'rising';
  } else if (slope < -0.02) {
    direction = 'falling';
  } else {
    direction = 'stable';
  }
  
  return {
    slope,
    direction,
    magnitude,
  };
}

// =============================================================================
// Transition Scoring
// =============================================================================

/**
 * Calculate how well two energy levels match.
 */
function calculateEnergyMatch(
  outgoingEnergy: Normalized,
  incomingEnergy: Normalized
): Normalized {
  // Perfect match when energies are equal
  // Slight preference for incoming to be slightly higher (builds energy)
  const diff = incomingEnergy - outgoingEnergy;
  
  if (Math.abs(diff) < 0.1) {
    return 1.0; // Very close = perfect
  }
  if (diff > 0 && diff < 0.3) {
    return 0.9; // Slight increase = great
  }
  if (diff > 0.3 && diff < 0.5) {
    return 0.7; // Moderate increase = good
  }
  if (diff < 0 && diff > -0.3) {
    return 0.6; // Slight decrease = acceptable
  }
  
  // Large differences are problematic
  return Math.max(0, 0.5 - Math.abs(diff) * 0.5);
}

/**
 * Calculate how well two momentum directions match.
 */
function calculateMomentumMatch(
  outgoingMomentum: EnergyMomentum,
  incomingMomentum: EnergyMomentum
): Normalized {
  // Best matches:
  // - rising -> rising (continuous build)
  // - falling -> falling (continuous release)
  // - stable -> stable (plateau)
  // - falling -> rising (classic DJ transition: breakdown -> drop)
  
  if (outgoingMomentum.direction === incomingMomentum.direction) {
    return 0.85; // Same direction = good
  }
  
  // Special case: outgoing falling into incoming rising (the classic transition)
  if (outgoingMomentum.direction === 'falling' && incomingMomentum.direction === 'rising') {
    return 1.0; // Perfect transition moment
  }
  
  // Stable to anything is fine
  if (outgoingMomentum.direction === 'stable' || incomingMomentum.direction === 'stable') {
    return 0.75;
  }
  
  // rising -> falling is jarring
  if (outgoingMomentum.direction === 'rising' && incomingMomentum.direction === 'falling') {
    return 0.4;
  }
  
  return 0.6;
}

/**
 * Calculate contrast score (for variety in the mix).
 */
function calculateContrastScore(
  outgoingAvgEnergy: Normalized,
  incomingAvgEnergy: Normalized,
  outgoingPeakDensity: Normalized,
  incomingPeakDensity: Normalized
): Normalized {
  // Some contrast is good, too much is jarring
  const energyContrast = Math.abs(outgoingAvgEnergy - incomingAvgEnergy);
  const peakContrast = Math.abs(outgoingPeakDensity - incomingPeakDensity);
  
  // Ideal contrast is 0.1-0.3
  let score = 0.5;
  
  if (energyContrast >= 0.1 && energyContrast <= 0.3) {
    score += 0.25;
  } else if (energyContrast < 0.1) {
    score += 0.1; // Too similar
  } else if (energyContrast > 0.5) {
    score -= 0.2; // Too different
  }
  
  if (peakContrast >= 0.05 && peakContrast <= 0.2) {
    score += 0.25;
  }
  
  return Math.max(0, Math.min(1, score));
}

/**
 * Score a transition between two tracks at specific points.
 * 
 * @param outgoingCurve - Energy curve of the outgoing track
 * @param outgoingExitTime - Exit point in the outgoing track
 * @param incomingCurve - Energy curve of the incoming track
 * @param incomingEntryTime - Entry point in the incoming track
 * @param options - Scoring options
 */
export function scoreTransition(
  outgoingCurve: EnergyCurve,
  outgoingExitTime: AudioTimeSec,
  incomingCurve: EnergyCurve,
  incomingEntryTime: AudioTimeSec,
  options: TransitionScoringOptions = {}
): TransitionScore {
  const {
    energyMatchWeight = DEFAULT_ENERGY_WEIGHT,
    momentumMatchWeight = DEFAULT_MOMENTUM_WEIGHT,
    contrastWeight = DEFAULT_CONTRAST_WEIGHT,
  } = options;
  
  // Get energy at transition points
  const outgoingEnergy = getEnergyAtTime(outgoingCurve, outgoingExitTime);
  const incomingEnergy = getEnergyAtTime(incomingCurve, incomingEntryTime);
  
  // Get momentum at transition points
  const outgoingMomentum = getEnergyMomentum(outgoingCurve, outgoingExitTime);
  const incomingMomentum = getEnergyMomentum(incomingCurve, incomingEntryTime);
  
  // Get average energy for contrast calculation
  const outgoingAvgEnergy = getAverageEnergyInRange(
    outgoingCurve,
    Math.max(0, outgoingExitTime - 30),
    outgoingExitTime
  );
  const incomingAvgEnergy = getAverageEnergyInRange(
    incomingCurve,
    incomingEntryTime,
    Math.min(incomingCurve.duration, incomingEntryTime + 30)
  );
  
  // Calculate peak density (peaks per 30 seconds)
  const outgoingPeaks = outgoingCurve.peaks.filter(
    p => p / outgoingCurve.sampleRate >= outgoingExitTime - 30 &&
         p / outgoingCurve.sampleRate <= outgoingExitTime
  ).length / 30;
  
  const incomingPeaks = incomingCurve.peaks.filter(
    p => p / incomingCurve.sampleRate >= incomingEntryTime &&
         p / incomingCurve.sampleRate <= incomingEntryTime + 30
  ).length / 30;
  
  // Calculate individual scores
  const energyMatch = calculateEnergyMatch(outgoingEnergy, incomingEnergy);
  const momentumMatch = calculateMomentumMatch(outgoingMomentum, incomingMomentum);
  const contrastScore = calculateContrastScore(
    outgoingAvgEnergy,
    incomingAvgEnergy,
    outgoingPeaks,
    incomingPeaks
  );
  
  // Calculate weighted overall score
  const overall = 
    energyMatch * energyMatchWeight +
    momentumMatch * momentumMatchWeight +
    contrastScore * contrastWeight;
  
  return {
    energyMatch,
    momentumMatch,
    contrastScore,
    overall,
  };
}

/**
 * Find the best transition points between two tracks.
 * 
 * @param outgoingCurve - Energy curve of the outgoing track
 * @param incomingCurve - Energy curve of the incoming track
 * @param minExitTime - Minimum time in outgoing track for exit
 * @param maxEntryTime - Maximum time in incoming track for entry
 * @param count - Number of candidates to return
 */
export function findBestTransitionPoints(
  outgoingCurve: EnergyCurve,
  incomingCurve: EnergyCurve,
  minExitTime: AudioTimeSec = 30,
  maxEntryTime: AudioTimeSec = 60,
  count: number = 5
): TransitionCandidate[] {
  const candidates: TransitionCandidate[] = [];
  
  // Check valleys in outgoing track as exit points
  for (const valleyIdx of outgoingCurve.valleys) {
    const exitTime = valleyIdx / outgoingCurve.sampleRate;
    if (exitTime < minExitTime) continue;
    
    // Check valleys in incoming track as entry points
    for (const entryValleyIdx of incomingCurve.valleys) {
      const entryTime = entryValleyIdx / incomingCurve.sampleRate;
      if (entryTime > maxEntryTime) continue;
      
      const score = scoreTransition(
        outgoingCurve,
        exitTime,
        incomingCurve,
        entryTime
      );
      
      candidates.push({
        exitTime,
        entryTime,
        score,
      });
    }
    
    // Also check peaks in incoming track (for energy contrast)
    for (const entryPeakIdx of incomingCurve.peaks) {
      const entryTime = entryPeakIdx / incomingCurve.sampleRate;
      if (entryTime > maxEntryTime) continue;
      
      const score = scoreTransition(
        outgoingCurve,
        exitTime,
        incomingCurve,
        entryTime
      );
      
      candidates.push({
        exitTime,
        entryTime,
        score,
      });
    }
  }
  
  // Sort by overall score and return top candidates
  return candidates
    .sort((a, b) => b.score.overall - a.score.overall)
    .slice(0, count);
}

/**
 * Create a simple energy curve from periodic energy samples.
 * Useful when you have data from an FFT analyzer.
 * 
 * @throws Error if duration is not a positive finite number
 * @throws Error if samples array is empty
 */
export function createEnergyCurveFromSamples(
  samples: number[],
  duration: DurationSec
): EnergyCurve {
  if (!(duration > 0 && Number.isFinite(duration))) {
    throw new Error(`Invalid duration: ${duration}. Must be a positive finite number.`);
  }
  if (samples.length === 0) {
    throw new Error('Cannot create energy curve from empty samples array.');
  }
  const sampleRate = samples.length / duration;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid computed sampleRate: ${sampleRate}`);
  }
  return analyzeEnergy(
    new Float32Array(samples),
    sampleRate,
    duration,
    { outputSampleRate: sampleRate }
  );
}
