/**
 * Tempo Module Tests
 * 
 * Tests for beat grid construction, tempo matching, and phase alignment.
 */

import { describe, it, expect } from 'vitest';
import {
  constructBeatGrid,
  constructBeatGridFromBpm,
  getBeatDuration,
  getBarDuration,
  getBeatAtTime,
  getBarAtTime,
  getGridPosition,
  getTimeAtBeat,
  getTimeAtBar,
  getNextPhraseBoundary,
  getPhraseBoundariesInRange,
} from '../tempo/beatgrid';
import {
  calculatePlaybackRate,
  isTempoMatchFeasible,
  calculatePhaseOffset,
  matchTempo,
  snapToBeat,
  snapToBar,
} from '../tempo/matcher';
import type { BeatGrid, BeatDetection } from '../tempo';
import { DEFAULT_TEMPO_CONSTRAINTS } from '../types';

describe('constructBeatGrid', () => {
  it('creates a grid from detection results', () => {
    const detection: BeatDetection = {
      bpm: 128.5,
      confidence: 0.9,
      beats: [0, 0.468, 0.937, 1.405],
      firstDownbeat: 0,
    };

    const grid = constructBeatGrid(detection);

    expect(grid.bpm).toBe(128); // Snapped to common BPM
    expect(grid.beatsPerBar).toBe(4);
    expect(grid.confidence).toBe(0.9);
  });

  it('uses fallback BPM for low confidence', () => {
    const detection: BeatDetection = {
      bpm: 142,
      confidence: 0.3, // Below default threshold
      beats: [],
      firstDownbeat: 0,
    };

    const grid = constructBeatGrid(detection, { fallbackBpm: 120 });

    expect(grid.bpm).toBe(120);
    expect(grid.confidence).toBe(0);
  });

  it('uses fallback BPM for null detection', () => {
    const grid = constructBeatGrid(null, { fallbackBpm: 125 });

    expect(grid.bpm).toBe(125);
    expect(grid.confidence).toBe(0);
  });

  it('snaps to common BPM values', () => {
    const detection: BeatDetection = {
      bpm: 128.5, // Close to 128 (within 1.5 threshold)
      confidence: 0.9,
      beats: [],
      firstDownbeat: 0,
    };

    const grid = constructBeatGrid(detection, { snapToCommon: true });
    expect(grid.bpm).toBe(128);
  });

  it('respects snapToCommon: false', () => {
    const detection: BeatDetection = {
      bpm: 127.3,
      confidence: 0.9,
      beats: [],
      firstDownbeat: 0,
    };

    const grid = constructBeatGrid(detection, { snapToCommon: false });
    expect(grid.bpm).toBe(127);
  });
});

describe('constructBeatGridFromBpm', () => {
  it('creates a grid from just BPM', () => {
    const grid = constructBeatGridFromBpm(128);

    expect(grid.bpm).toBe(128);
    expect(grid.beatsPerBar).toBe(4);
    expect(grid.firstDownbeat).toBe(0);
    expect(grid.confidence).toBe(0.8);
  });

  it('handles null BPM with fallback', () => {
    const grid = constructBeatGridFromBpm(null);

    expect(grid.bpm).toBe(120); // Default fallback
    expect(grid.confidence).toBe(0);
  });

  it('handles invalid BPM values', () => {
    expect(constructBeatGridFromBpm(0).bpm).toBe(120);
    expect(constructBeatGridFromBpm(-50).bpm).toBe(120);
    expect(constructBeatGridFromBpm(NaN).bpm).toBe(120);
  });
});

describe('getBeatDuration', () => {
  it('calculates correct beat duration', () => {
    const grid = constructBeatGridFromBpm(120);
    expect(getBeatDuration(grid)).toBe(0.5); // 60/120 = 0.5s
  });

  it('handles different BPMs', () => {
    expect(getBeatDuration(constructBeatGridFromBpm(60))).toBe(1.0);
    expect(getBeatDuration(constructBeatGridFromBpm(180))).toBeCloseTo(0.333, 2);
  });
});

describe('getBarDuration', () => {
  it('calculates correct bar duration for 4/4', () => {
    const grid = constructBeatGridFromBpm(120);
    expect(getBarDuration(grid)).toBe(2.0); // 4 beats at 0.5s each
  });
});

describe('getBeatAtTime', () => {
  const grid = constructBeatGridFromBpm(120); // 0.5s per beat

  it('returns correct beat index at beat boundaries', () => {
    expect(getBeatAtTime(grid, 0).index).toBe(0);
    expect(getBeatAtTime(grid, 0.5).index).toBe(1);
    expect(getBeatAtTime(grid, 1.0).index).toBe(2);
    expect(getBeatAtTime(grid, 2.0).index).toBe(4);
  });

  it('continues beat phase after the final explicit marker', () => {
    const finiteGrid = {
      bpm: 120,
      beatsPerBar: 4,
      firstDownbeat: 0,
      confidence: 1,
      beats: [0, 0.5, 1],
    };

    expect(getBeatAtTime(finiteGrid, 1.25)).toMatchObject({ index: 2, phase: 0.5 });
    expect(getBeatAtTime(finiteGrid, 1.5)).toMatchObject({ index: 3, phase: 0 });
  });

  it('returns correct beat phase', () => {
    expect(getBeatAtTime(grid, 0).phase).toBe(0);
    expect(getBeatAtTime(grid, 0.25).phase).toBeCloseTo(0.5, 2);
    expect(getBeatAtTime(grid, 0.4).phase).toBeCloseTo(0.8, 2);
  });

  it('handles fractional positions correctly', () => {
    const result = getBeatAtTime(grid, 1.25);
    expect(result.index).toBe(2);
    expect(result.phase).toBeCloseTo(0.5, 2);
  });
});

describe('getBarAtTime', () => {
  const grid = constructBeatGridFromBpm(120); // 2s per bar

  it('returns correct bar index', () => {
    expect(getBarAtTime(grid, 0).index).toBe(0);
    expect(getBarAtTime(grid, 2.0).index).toBe(1);
    expect(getBarAtTime(grid, 4.0).index).toBe(2);
  });

  it('returns correct bar phase', () => {
    expect(getBarAtTime(grid, 0).phase).toBe(0);
    expect(getBarAtTime(grid, 1.0).phase).toBeCloseTo(0.5, 2); // Halfway through bar
  });
});

describe('getGridPosition', () => {
  const grid = constructBeatGridFromBpm(120);

  it('returns comprehensive position info', () => {
    const pos = getGridPosition(grid, 5.25); // 5.25s into track

    expect(pos.beatIndex).toBe(10); // 5.25 / 0.5 = 10.5, floor = 10
    expect(pos.barIndex).toBe(2); // beat 10 / 4 = bar 2
    expect(pos.beatPhase).toBeCloseTo(0.5, 2);
    expect(pos.timeSinceLastBeat).toBeCloseTo(250, 0); // 0.25s = 250ms
    expect(pos.timeToNextBeat).toBeCloseTo(250, 0);
  });
});

describe('getTimeAtBeat / getTimeAtBar', () => {
  const grid = constructBeatGridFromBpm(120);

  it('calculates time at beat correctly', () => {
    expect(getTimeAtBeat(grid, 0)).toBe(0);
    expect(getTimeAtBeat(grid, 4)).toBe(2.0);
    expect(getTimeAtBeat(grid, 8)).toBe(4.0);
  });

  it('calculates time at bar correctly', () => {
    expect(getTimeAtBar(grid, 0)).toBe(0);
    expect(getTimeAtBar(grid, 1)).toBe(2.0);
    expect(getTimeAtBar(grid, 4)).toBe(8.0);
  });
});

describe('getNextPhraseBoundary', () => {
  const grid = constructBeatGridFromBpm(120); // 2s per bar

  it('finds next 16-bar phrase boundary', () => {
    const boundary = getNextPhraseBoundary(grid, 5, 16);
    expect(boundary).toBe(32); // 16 bars * 2s = 32s
  });

  it('finds next 4-bar phrase boundary', () => {
    const boundary = getNextPhraseBoundary(grid, 5, 4);
    expect(boundary).toBe(8); // 4 bars * 2s = 8s
  });

  it('handles position at phrase boundary', () => {
    const boundary = getNextPhraseBoundary(grid, 32, 16);
    expect(boundary).toBe(64); // Next phrase, not current
  });
});

describe('getPhraseBoundariesInRange', () => {
  const grid = constructBeatGridFromBpm(120); // 2s per bar

  it('finds all phrase boundaries in range', () => {
    const boundaries = getPhraseBoundariesInRange(grid, 0, 100, 8);
    // 8 bars = 16s, so boundaries at 16, 32, 48, 64, 80, 96
    expect(boundaries.length).toBe(6);
    expect(boundaries[0]).toBe(16);
    expect(boundaries[1]).toBe(32);
  });
});

describe('calculatePlaybackRate', () => {
  it('calculates correct rate to match tempos', () => {
    // To slow down 130 BPM to match 120 BPM
    const rate = calculatePlaybackRate(120, 130);
    expect(rate).toBeCloseTo(0.923, 2); // 120/130
  });

  it('calculates rate to speed up', () => {
    // To speed up 120 BPM to match 128 BPM
    const rate = calculatePlaybackRate(128, 120);
    expect(rate).toBeCloseTo(1.067, 2); // 128/120
  });

  it('clamps to constraint range', () => {
    // Too large a difference
    const rate = calculatePlaybackRate(150, 100);
    expect(rate).toBe(1.08); // Clamped to max
  });

  it('handles half-time detection', () => {
    // 140 BPM target for 70 BPM source (double time)
    const rate = calculatePlaybackRate(70, 140);
    expect(rate).toBe(1); // Detects half-time relationship
  });

  it('handles invalid input', () => {
    expect(calculatePlaybackRate(0, 120)).toBe(1);
    expect(calculatePlaybackRate(120, 0)).toBe(1);
    expect(calculatePlaybackRate(NaN, 120)).toBe(1);
  });
});

describe('isTempoMatchFeasible', () => {
  it('returns true for close tempos', () => {
    expect(isTempoMatchFeasible(128, 125)).toBe(true);
    expect(isTempoMatchFeasible(120, 128)).toBe(true);
  });

  it('returns false for very different tempos', () => {
    // 120 to 180 is 1.5x which is outside the typical 0.92-1.08 range
    // Note: half-time detection might kick in, so use a ratio that won't trigger it
    expect(isTempoMatchFeasible(100, 180)).toBe(false); // 1.8x ratio
  });
});

describe('calculatePhaseOffset', () => {
  it('returns 0 offset for aligned phases', () => {
    const result = calculatePhaseOffset(0.5, 0.5, 500);
    expect(result.offsetMs).toBe(0);
    expect(result.quality).toBe(1);
  });

  it('calculates correct offset for misaligned phases', () => {
    const result = calculatePhaseOffset(0.75, 0.5, 500);
    expect(result.offsetMs).toBe(125); // 0.25 * 500ms
    expect(result.phaseDifference).toBeCloseTo(0.25, 2);
  });

  it('takes shortest path around the cycle', () => {
    const result = calculatePhaseOffset(0.9, 0.1, 500);
    // Difference is 0.2 (not 0.8), offset is 0.2 * 500 = 100ms
    expect(Math.abs(result.offsetMs)).toBeCloseTo(100, 1);
  });
});

describe('matchTempo', () => {
  const source = constructBeatGridFromBpm(128);
  const target = constructBeatGridFromBpm(124);

  it('returns complete match result', () => {
    const result = matchTempo(source, target);

    expect(result.targetPlaybackRate).toBeCloseTo(1.032, 2); // 128/124
    expect(result.feasible).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('includes phase offset when times provided', () => {
    const result = matchTempo(source, target, DEFAULT_TEMPO_CONSTRAINTS, 10, 0);

    expect(typeof result.phaseOffsetMs).toBe('number');
  });

  it('marks infeasible matches', () => {
    // Need a tempo ratio that's truly outside bounds and won't trigger half-time detection
    const slowSource = constructBeatGridFromBpm(100);
    const fastTarget = constructBeatGridFromBpm(180); // 1.8x ratio

    const result = matchTempo(slowSource, fastTarget);
    expect(result.feasible).toBe(false);
  });
});

describe('snapToBeat', () => {
  const grid = constructBeatGridFromBpm(120); // 0.5s per beat

  it('snaps to current beat when close', () => {
    const snapped = snapToBeat(grid, 1.1);
    expect(snapped).toBeCloseTo(1.0, 2);
  });

  it('snaps to next beat when past midpoint', () => {
    const snapped = snapToBeat(grid, 1.3);
    expect(snapped).toBeCloseTo(1.5, 2);
  });

  it('respects roundUp option', () => {
    const snapped = snapToBeat(grid, 1.1, true);
    expect(snapped).toBeCloseTo(1.5, 2);
  });
});

describe('snapToBar', () => {
  const grid = constructBeatGridFromBpm(120); // 2s per bar

  it('snaps to current bar when close', () => {
    const snapped = snapToBar(grid, 2.3);
    expect(snapped).toBeCloseTo(2.0, 2);
  });

  it('snaps to next bar when past midpoint', () => {
    const snapped = snapToBar(grid, 3.2);
    expect(snapped).toBeCloseTo(4.0, 2);
  });
});
