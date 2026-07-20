/**
 * Beat Grid Construction and Navigation
 * 
 * Functions for constructing beat grids from audio analysis
 * and navigating within them.
 */

import type { 
  BeatGrid, 
  AudioTimeSec, 
  BeatIndex, 
  BarIndex, 
  BPM,
  Normalized,
  DurationMs,
} from '../types';
import type { BeatDetection, BeatGridOptions, GridPosition } from './types';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BPM: BPM = 120;
const DEFAULT_BEATS_PER_BAR = 4;
const MIN_CONFIDENCE = 0.5;

/** Common BPM values to snap to */
const COMMON_BPMS: BPM[] = [
  80, 85, 90, 95, 100, 105, 110, 115, 120, 122, 124, 125, 126, 128, 130,
  132, 135, 138, 140, 145, 150, 155, 160, 165, 170, 174, 175, 180,
];

// =============================================================================
// Beat Grid Construction
// =============================================================================

/**
 * Snap a BPM value to the nearest common BPM if within threshold.
 */
function snapToCommonBpm(bpm: BPM, threshold: number = 1.5): BPM {
  for (const common of COMMON_BPMS) {
    if (Math.abs(bpm - common) <= threshold) {
      return common;
    }
  }
  return Math.round(bpm);
}

/**
 * Construct a beat grid from beat detection results.
 * 
 * @param detection - Beat detection results from audio analysis
 * @param options - Grid construction options
 * @returns A normalized beat grid
 */
export function constructBeatGrid(
  detection: BeatDetection | null,
  options: BeatGridOptions = {}
): BeatGrid {
  const {
    fallbackBpm = DEFAULT_BPM,
    minConfidence = MIN_CONFIDENCE,
    snapToCommon = true,
  } = options;
  
  // Use fallback if no detection or low confidence
  if (!detection || detection.confidence < minConfidence) {
    return {
      bpm: fallbackBpm,
      beatsPerBar: DEFAULT_BEATS_PER_BAR,
      firstDownbeat: 0,
      confidence: 0,
    };
  }
  
  // Snap BPM if enabled
  const bpm = snapToCommon 
    ? snapToCommonBpm(detection.bpm)
    : Math.round(detection.bpm);
  
  return {
    bpm,
    beatsPerBar: DEFAULT_BEATS_PER_BAR,
    firstDownbeat: detection.firstDownbeat,
    beats: detection.beats,
    confidence: detection.confidence,
  };
}

/**
 * Construct a beat grid from just BPM (no beat detection).
 */
export function constructBeatGridFromBpm(
  bpm: BPM | null | undefined,
  firstDownbeat: AudioTimeSec = 0
): BeatGrid {
  const safeBpm = bpm && Number.isFinite(bpm) && bpm > 0 ? bpm : DEFAULT_BPM;
  
  return {
    bpm: Math.round(safeBpm),
    beatsPerBar: DEFAULT_BEATS_PER_BAR,
    firstDownbeat,
    confidence: bpm ? 0.8 : 0,
  };
}

// =============================================================================
// Beat Grid Navigation
// =============================================================================

/**
 * Calculate the duration of a single beat in seconds.
 */
export function getBeatDuration(grid: BeatGrid): AudioTimeSec {
  return 60 / grid.bpm;
}

/**
 * Calculate the duration of a single bar in seconds.
 */
export function getBarDuration(grid: BeatGrid): AudioTimeSec {
  return (60 / grid.bpm) * grid.beatsPerBar;
}

/**
 * Get the beat at a specific time position.
 * 
 * @param grid - The beat grid
 * @param timeSec - Current time in seconds
 * @returns Beat index and phase information
 */
export function getBeatAtTime(grid: BeatGrid, timeSec: AudioTimeSec): { 
  index: BeatIndex; 
  phase: Normalized;
} {
  // If we have explicit beat markers, use binary search
  if (grid.beats && grid.beats.length > 0) {
    const firstBeatTime = grid.beats[0];
    const lastBeatIndex = grid.beats.length - 1;
    const lastBeatTime = grid.beats[lastBeatIndex];
    const beatDuration = getBeatDuration(grid);

    if (timeSec < firstBeatTime) {
      const position = (timeSec - firstBeatTime) / beatDuration;
      const wholeBeats = Math.floor(position);
      return {
        index: wholeBeats,
        phase: position - wholeBeats,
      };
    }

    if (timeSec >= lastBeatTime) {
      const position = (timeSec - lastBeatTime) / beatDuration;
      const wholeBeats = Math.floor(position);
      return {
        index: lastBeatIndex + wholeBeats,
        phase: position - wholeBeats,
      };
    }

    let low = 0;
    let high = lastBeatIndex;
    
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (grid.beats[mid] <= timeSec) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    
    const beatTime = grid.beats[low];
    const nextBeatTime = grid.beats[low + 1];
    const phase = (timeSec - beatTime) / (nextBeatTime - beatTime);
    
    return {
      index: low,
      phase: Math.max(0, Math.min(1, phase)),
    };
  }
  
  // Otherwise, calculate from BPM
  const beatDuration = getBeatDuration(grid);
  const timeSinceFirst = timeSec - grid.firstDownbeat;
  
  if (timeSinceFirst < 0) {
    // Before first downbeat
    const beatsBeforeFirst = Math.abs(timeSinceFirst) / beatDuration;
    return {
      index: -Math.ceil(beatsBeforeFirst),
      phase: 1 - (beatsBeforeFirst % 1),
    };
  }
  
  const beatIndex = Math.floor(timeSinceFirst / beatDuration);
  const phase = (timeSinceFirst % beatDuration) / beatDuration;
  
  return {
    index: beatIndex,
    phase,
  };
}

/**
 * Get the bar at a specific time position.
 */
export function getBarAtTime(grid: BeatGrid, timeSec: AudioTimeSec): {
  index: BarIndex;
  phase: Normalized;
} {
  const beat = getBeatAtTime(grid, timeSec);
  const barIndex = Math.floor(beat.index / grid.beatsPerBar);
  // Use non-negative modulo to handle negative beat indices correctly
  const beatInBar = ((beat.index % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar;
  const barPhase = (beatInBar + beat.phase) / grid.beatsPerBar;
  
  return {
    index: barIndex,
    phase: Math.max(0, Math.min(1, barPhase)),
  };
}

/**
 * Get detailed position information within the grid.
 */
export function getGridPosition(grid: BeatGrid, timeSec: AudioTimeSec): GridPosition {
  const beat = getBeatAtTime(grid, timeSec);
  const bar = getBarAtTime(grid, timeSec);
  const beatDuration = getBeatDuration(grid);
  
  const timeSinceLastBeat = beat.phase * beatDuration * 1000;
  const timeToNextBeat = (1 - beat.phase) * beatDuration * 1000;
  
  return {
    beatIndex: beat.index,
    barIndex: bar.index,
    beatPhase: beat.phase,
    barPhase: bar.phase,
    timeSinceLastBeat,
    timeToNextBeat,
  };
}

/**
 * Get the time of a specific beat.
 */
export function getTimeAtBeat(grid: BeatGrid, beatIndex: BeatIndex): AudioTimeSec {
  if (grid.beats && grid.beats[beatIndex] !== undefined) {
    return grid.beats[beatIndex];
  }
  
  const beatDuration = getBeatDuration(grid);
  return grid.firstDownbeat + beatIndex * beatDuration;
}

/**
 * Get the time of a specific bar.
 */
export function getTimeAtBar(grid: BeatGrid, barIndex: BarIndex): AudioTimeSec {
  return getTimeAtBeat(grid, barIndex * grid.beatsPerBar);
}

/**
 * Find the next phrase boundary (every N bars).
 * 
 * @param grid - The beat grid
 * @param timeSec - Current time
 * @param phraseBars - Bars per phrase (typically 4, 8, or 16)
 */
export function getNextPhraseBoundary(
  grid: BeatGrid,
  timeSec: AudioTimeSec,
  phraseBars: number = 16
): AudioTimeSec {
  const bar = getBarAtTime(grid, timeSec);
  const nextPhraseBar = (Math.floor(bar.index / phraseBars) + 1) * phraseBars;
  return getTimeAtBar(grid, nextPhraseBar);
}

/**
 * Get all phrase boundaries within a time range.
 */
export function getPhraseBoundariesInRange(
  grid: BeatGrid,
  startSec: AudioTimeSec,
  endSec: AudioTimeSec,
  phraseBars: number = 16
): AudioTimeSec[] {
  const boundaries: AudioTimeSec[] = [];
  let time = getNextPhraseBoundary(grid, startSec, phraseBars);
  
  while (time <= endSec) {
    boundaries.push(time);
    time = getNextPhraseBoundary(grid, time + 0.1, phraseBars);
  }
  
  return boundaries;
}
