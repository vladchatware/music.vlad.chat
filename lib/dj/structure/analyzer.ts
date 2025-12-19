/**
 * Structure Analyzer
 * 
 * Analyzes track structure to detect phrases and sections.
 * Uses energy contours and pattern detection to find musical boundaries.
 */

import type { 
  BeatGrid, 
  Phrase, 
  Section, 
  StructureMap,
  PhraseType,
  AudioTimeSec,
  Normalized,
  DurationSec,
} from '../types';
import type { 
  EnergyChange, 
  StructureAnalysisOptions, 
  PhraseBoundary 
} from './types';
import { getBeatDuration, getBarDuration, getBeatAtTime, getTimeAtBar, getBarAtTime } from '../tempo/beatgrid';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MIN_PHRASE_BARS = 4;
const DEFAULT_MAX_PHRASE_BARS = 32;
const DEFAULT_ENERGY_THRESHOLD = 0.2;

// Energy thresholds for section classification
const ENERGY_THRESHOLDS = {
  intro: 0.25,      // Low energy
  comeup: 0.45,     // Rising energy
  culmination: 0.65, // High energy
  breakdown: 0.35,   // Medium-low energy
};

// =============================================================================
// Energy Analysis
// =============================================================================

/**
 * Calculate the average energy in a time window.
 */
function getAverageEnergy(
  energyCurve: Float32Array,
  sampleRate: number,
  startSec: AudioTimeSec,
  endSec: AudioTimeSec
): Normalized {
  const startIdx = Math.floor(startSec * sampleRate);
  const endIdx = Math.min(Math.floor(endSec * sampleRate), energyCurve.length - 1);
  
  if (startIdx >= endIdx) return 0;
  
  let sum = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    sum += energyCurve[i];
  }
  
  return sum / (endIdx - startIdx + 1);
}

/**
 * Calculate the energy slope (rate of change) in a time window.
 */
function getEnergySlope(
  energyCurve: Float32Array,
  sampleRate: number,
  startSec: AudioTimeSec,
  endSec: AudioTimeSec
): number {
  const startIdx = Math.floor(startSec * sampleRate);
  const endIdx = Math.min(Math.floor(endSec * sampleRate), energyCurve.length - 1);
  
  if (startIdx >= endIdx) return 0;
  
  const startEnergy = energyCurve[startIdx];
  const endEnergy = energyCurve[endIdx];
  const duration = endSec - startSec;
  
  return (endEnergy - startEnergy) / duration;
}

/**
 * Detect significant energy changes in the track.
 */
function detectEnergyChanges(
  energyCurve: Float32Array,
  sampleRate: number,
  grid: BeatGrid,
  duration: DurationSec,
  threshold: Normalized
): EnergyChange[] {
  const changes: EnergyChange[] = [];
  const barDuration = getBarDuration(grid);
  const windowSec = barDuration * 2; // 2-bar analysis window
  
  let previousEnergy = getAverageEnergy(energyCurve, sampleRate, 0, windowSec);
  
  for (let time = windowSec; time < duration - windowSec; time += windowSec / 2) {
    const currentEnergy = getAverageEnergy(energyCurve, sampleRate, time, time + windowSec);
    const diff = currentEnergy - previousEnergy;
    
    if (Math.abs(diff) > threshold) {
      const beat = getBeatAtTime(grid, time);
      
      let type: EnergyChange['type'];
      if (diff > 0.4) {
        type = 'drop'; // Sudden large increase
      } else if (diff > threshold) {
        type = 'rise'; // Gradual increase
      } else if (diff < -0.4) {
        type = 'buildup'; // Often precedes a drop (energy dips before exploding)
      } else {
        type = 'fall'; // Gradual decrease
      }
      
      changes.push({
        time,
        beatIndex: beat.index,
        type,
        magnitude: Math.abs(diff),
      });
    }
    
    previousEnergy = currentEnergy;
  }
  
  return changes;
}

// =============================================================================
// Phrase Detection
// =============================================================================

/**
 * Detect phrase boundaries based on energy changes and bar alignment.
 */
function detectPhraseBoundaries(
  energyCurve: Float32Array,
  sampleRate: number,
  grid: BeatGrid,
  duration: DurationSec,
  options: StructureAnalysisOptions
): PhraseBoundary[] {
  const boundaries: PhraseBoundary[] = [];
  const barDuration = getBarDuration(grid);
  const minPhraseLength = (options.minPhraseBars ?? DEFAULT_MIN_PHRASE_BARS) * barDuration;
  const maxPhraseLength = (options.maxPhraseBars ?? DEFAULT_MAX_PHRASE_BARS) * barDuration;
  
  // Start with track beginning
  boundaries.push({
    time: 0,
    beatIndex: 0,
    confidence: 1,
    reason: 'forced',
  });
  
  // Detect energy-based boundaries
  const energyChanges = detectEnergyChanges(
    energyCurve,
    sampleRate,
    grid,
    duration,
    options.energyChangeThreshold ?? DEFAULT_ENERGY_THRESHOLD
  );
  
  // Convert energy changes to phrase boundaries (snap to bar boundaries)
  for (const change of energyChanges) {
    // Snap to nearest bar
    const barIndex = Math.round(change.beatIndex / grid.beatsPerBar);
    const snappedTime = getTimeAtBar(grid, barIndex);
    
    // Check minimum distance from last boundary
    const lastBoundary = boundaries[boundaries.length - 1];
    if (snappedTime - lastBoundary.time >= minPhraseLength) {
      boundaries.push({
        time: snappedTime,
        beatIndex: barIndex * grid.beatsPerBar,
        confidence: Math.min(1, change.magnitude / 0.3),
        reason: 'energy',
      });
    }
  }
  
  // Add forced boundaries at regular intervals for very long phrases
  let lastBoundaryTime = 0;
  const forcedBoundaries: PhraseBoundary[] = [];
  
  for (let time = 0; time < duration; time += barDuration) {
    const timeSinceLast = time - lastBoundaryTime;
    
    // Check if this is an existing boundary
    const isExisting = boundaries.some(b => Math.abs(b.time - time) < barDuration / 2);
    
    if (isExisting) {
      lastBoundaryTime = time;
    } else if (timeSinceLast >= maxPhraseLength) {
      // Force a boundary at 8 or 16 bar intervals
      // Use getBarAtTime to properly account for grid.firstDownbeat
      const bar = getBarAtTime(grid, time);
      if (bar.index % 8 === 0) { // Prefer 8-bar boundaries
        forcedBoundaries.push({
          time,
          beatIndex: bar.index * grid.beatsPerBar,
          confidence: 0.5,
          reason: 'forced',
        });
        lastBoundaryTime = time;
      }
    }
  }
  
  // Merge and sort all boundaries
  const allBoundaries = [...boundaries, ...forcedBoundaries]
    .sort((a, b) => a.time - b.time);
  
  // Add track end
  allBoundaries.push({
    time: duration,
    beatIndex: Math.floor(duration / getBeatDuration(grid)),
    confidence: 1,
    reason: 'forced',
  });
  
  return allBoundaries;
}

/**
 * Classify a phrase based on its energy characteristics.
 */
function classifyPhrase(
  avgEnergy: Normalized,
  energySlope: number,
  isFirst: boolean,
  isLast: boolean
): PhraseType {
  // Intro and outro detection
  if (isFirst && avgEnergy < ENERGY_THRESHOLDS.intro) {
    return 'intro';
  }
  if (isLast && avgEnergy < ENERGY_THRESHOLDS.intro) {
    return 'outro';
  }
  
  // Energy-based classification
  if (avgEnergy > ENERGY_THRESHOLDS.culmination) {
    return 'drop';
  }
  if (avgEnergy < ENERGY_THRESHOLDS.breakdown && Math.abs(energySlope) < 0.02) {
    return 'breakdown';
  }
  if (energySlope > 0.02 && avgEnergy < ENERGY_THRESHOLDS.comeup) {
    return 'buildup';
  }
  if (avgEnergy >= ENERGY_THRESHOLDS.intro && avgEnergy < ENERGY_THRESHOLDS.culmination) {
    return 'verse';
  }
  
  return 'unknown';
}

/**
 * Detect phrases from phrase boundaries.
 */
export function detectPhrases(
  energyCurve: Float32Array,
  sampleRate: number,
  grid: BeatGrid,
  duration: DurationSec,
  options: StructureAnalysisOptions = {}
): Phrase[] {
  const boundaries = detectPhraseBoundaries(
    energyCurve,
    sampleRate,
    grid,
    duration,
    options
  );
  
  const phrases: Phrase[] = [];
  const barDuration = getBarDuration(grid);
  
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    
    const avgEnergy = getAverageEnergy(energyCurve, sampleRate, start.time, end.time);
    const energySlope = getEnergySlope(energyCurve, sampleRate, start.time, end.time);
    
    const isFirst = i === 0;
    const isLast = i === boundaries.length - 2;
    
    const phraseType = classifyPhrase(avgEnergy, energySlope, isFirst, isLast);
    const lengthBars = Math.round((end.time - start.time) / barDuration);
    
    phrases.push({
      startBeat: start.beatIndex,
      lengthBars,
      type: phraseType,
      energy: avgEnergy,
      startTime: start.time,
      endTime: end.time,
    });
  }
  
  return phrases;
}

// =============================================================================
// Section Detection
// =============================================================================

/**
 * Group phrases into higher-level sections.
 */
function groupPhrasesIntoSections(phrases: Phrase[]): Section[] {
  if (phrases.length === 0) return [];
  
  const sections: Section[] = [];
  let currentPhrases: Phrase[] = [phrases[0]];
  let currentType = phrases[0].type;
  
  for (let i = 1; i < phrases.length; i++) {
    const phrase = phrases[i];
    
    // Check if this phrase should be grouped with current section
    const shouldGroup = 
      phrase.type === currentType ||
      (phrase.type === 'unknown' && currentPhrases.length < 4) ||
      (currentType === 'unknown' && currentPhrases.length < 2);
    
    if (shouldGroup) {
      currentPhrases.push(phrase);
      if (phrase.type !== 'unknown') {
        currentType = phrase.type;
      }
    } else {
      // Close current section and start new one
      const sectionEnergy = currentPhrases.reduce((sum, p) => sum + p.energy, 0) / currentPhrases.length;
      
      sections.push({
        type: currentType,
        phrases: currentPhrases,
        startTime: currentPhrases[0].startTime,
        endTime: currentPhrases[currentPhrases.length - 1].endTime,
        energy: sectionEnergy,
      });
      
      currentPhrases = [phrase];
      currentType = phrase.type;
    }
  }
  
  // Don't forget the last section
  if (currentPhrases.length > 0) {
    const sectionEnergy = currentPhrases.reduce((sum, p) => sum + p.energy, 0) / currentPhrases.length;
    
    sections.push({
      type: currentType,
      phrases: currentPhrases,
      startTime: currentPhrases[0].startTime,
      endTime: currentPhrases[currentPhrases.length - 1].endTime,
      energy: sectionEnergy,
    });
  }
  
  return sections;
}

// =============================================================================
// Main Analysis Function
// =============================================================================

/**
 * Analyze the complete structure of a track.
 * 
 * @param energyCurve - Energy levels over time (normalized 0-1)
 * @param sampleRate - Samples per second in the energy curve
 * @param grid - Beat grid for the track
 * @param duration - Total track duration in seconds
 * @param options - Analysis options
 */
export function analyzeStructure(
  energyCurve: Float32Array,
  sampleRate: number,
  grid: BeatGrid,
  duration: DurationSec,
  options: StructureAnalysisOptions = {}
): StructureMap {
  // Detect phrases
  const phrases = detectPhrases(energyCurve, sampleRate, grid, duration, options);
  
  // Group into sections
  const sections = groupPhrasesIntoSections(phrases);
  
  // Extract downbeats (phrase start times)
  const downbeats = phrases.map(p => p.startTime);
  
  return {
    phrases,
    downbeats,
    sections,
    duration,
  };
}

/**
 * Get the current section at a given time.
 */
export function getSectionAtTime(
  structure: StructureMap,
  timeSec: AudioTimeSec
): Section | null {
  for (const section of structure.sections) {
    if (timeSec >= section.startTime && timeSec < section.endTime) {
      return section;
    }
  }
  return null;
}

/**
 * Get the current phrase at a given time.
 */
export function getPhraseAtTime(
  structure: StructureMap,
  timeSec: AudioTimeSec
): Phrase | null {
  for (const phrase of structure.phrases) {
    if (timeSec >= phrase.startTime && timeSec < phrase.endTime) {
      return phrase;
    }
  }
  return null;
}

/**
 * Find good transition points (phrase boundaries with low energy).
 */
export function findTransitionPoints(
  structure: StructureMap,
  minTimeSec: AudioTimeSec = 0
): AudioTimeSec[] {
  return structure.phrases
    .filter(p => p.startTime >= minTimeSec)
    .filter(p => p.type === 'breakdown' || p.type === 'outro' || p.energy < 0.4)
    .map(p => p.startTime);
}
