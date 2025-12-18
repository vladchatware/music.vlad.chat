/**
 * EQ Module Tests
 * 
 * Tests for EQ curve creation and interpolation.
 */

import { describe, it, expect } from 'vitest';
import {
  getEQAtProgress,
  createBassSwapCurve,
  createFrequencySplitCurve,
  createSmoothCurve,
  createHighFirstCurve,
  getCurveByPreset,
} from '../eq/curves';
import type { EQCurve, EQKeyframe, EQBand } from '../types';

describe('createBassSwapCurve', () => {
  it('creates a curve with correct duration', () => {
    const curve = createBassSwapCurve({ durationSec: 16 });
    expect(curve.durationSec).toBe(16);
  });

  it('has outgoing and incoming keyframes', () => {
    const curve = createBassSwapCurve({ durationSec: 16 });
    expect(curve.outgoing.length).toBeGreaterThan(0);
    expect(curve.incoming.length).toBeGreaterThan(0);
  });

  it('starts outgoing at full volume', () => {
    const curve = createBassSwapCurve({ durationSec: 16 });
    const firstOutgoing = curve.outgoing[0];
    
    expect(firstOutgoing.time).toBe(0);
    expect(firstOutgoing.bands.low).toBe(1);
    expect(firstOutgoing.bands.mid).toBe(1);
    expect(firstOutgoing.bands.high).toBe(1);
  });

  it('ends outgoing at zero (or min level)', () => {
    const curve = createBassSwapCurve({ durationSec: 16, minLevel: 0 });
    const lastOutgoing = curve.outgoing[curve.outgoing.length - 1];
    
    expect(lastOutgoing.time).toBe(1);
    expect(lastOutgoing.bands.low).toBe(0);
    expect(lastOutgoing.bands.mid).toBe(0);
    expect(lastOutgoing.bands.high).toBe(0);
  });

  it('starts incoming at zero (or min level)', () => {
    const curve = createBassSwapCurve({ durationSec: 16, minLevel: 0 });
    const firstIncoming = curve.incoming[0];
    
    expect(firstIncoming.time).toBe(0);
    expect(firstIncoming.bands.low).toBe(0);
    expect(firstIncoming.bands.mid).toBe(0);
    expect(firstIncoming.bands.high).toBe(0);
  });

  it('ends incoming at full volume', () => {
    const curve = createBassSwapCurve({ durationSec: 16 });
    const lastIncoming = curve.incoming[curve.incoming.length - 1];
    
    expect(lastIncoming.time).toBe(1);
    expect(lastIncoming.bands.low).toBe(1);
    expect(lastIncoming.bands.mid).toBe(1);
    expect(lastIncoming.bands.high).toBe(1);
  });

  it('swaps bass at the midpoint', () => {
    const curve = createBassSwapCurve({ durationSec: 16, bassSwapPoint: 0.5 });
    
    // At midpoint, outgoing bass should be low
    const outgoingMid = curve.outgoing.find(k => k.time === 0.5);
    expect(outgoingMid?.bands.low).toBe(0);
    
    // At midpoint, incoming bass should be high
    const incomingMid = curve.incoming.find(k => k.time === 0.5);
    expect(incomingMid?.bands.low).toBeGreaterThan(0.5);
  });
});

describe('createFrequencySplitCurve', () => {
  it('creates a valid curve', () => {
    const curve = createFrequencySplitCurve({ durationSec: 8 });
    
    expect(curve.durationSec).toBe(8);
    expect(curve.outgoing.length).toBeGreaterThan(0);
    expect(curve.incoming.length).toBeGreaterThan(0);
  });

  it('keeps outgoing bass longer than highs', () => {
    const curve = createFrequencySplitCurve({ durationSec: 8 });
    
    // At 20% through, outgoing should still have bass
    const outgoingEarly = curve.outgoing.find(k => k.time === 0.2);
    expect(outgoingEarly?.bands.low).toBe(1);
    expect(outgoingEarly?.bands.high).toBeLessThan(1);
  });
});

describe('createSmoothCurve', () => {
  it('creates equal fades on all bands', () => {
    const curve = createSmoothCurve({ durationSec: 8 });
    
    // At each keyframe, all bands should be equal
    for (const keyframe of curve.outgoing) {
      expect(keyframe.bands.low).toBe(keyframe.bands.mid);
      expect(keyframe.bands.mid).toBe(keyframe.bands.high);
    }
    
    for (const keyframe of curve.incoming) {
      expect(keyframe.bands.low).toBe(keyframe.bands.mid);
      expect(keyframe.bands.mid).toBe(keyframe.bands.high);
    }
  });
});

describe('createHighFirstCurve', () => {
  it('brings in highs before bass on incoming', () => {
    const curve = createHighFirstCurve({ durationSec: 8 });
    
    // Early in transition, incoming highs should be higher than bass
    const incomingEarly = curve.incoming.find(k => k.time === 0.25);
    expect(incomingEarly?.bands.high).toBeGreaterThan(incomingEarly?.bands.low ?? 0);
  });
});

describe('getCurveByPreset', () => {
  it('returns correct curve for each preset', () => {
    const bassSwap = getCurveByPreset('bassSwap', { durationSec: 8 });
    const freqSplit = getCurveByPreset('frequencySplit', { durationSec: 8 });
    const smooth = getCurveByPreset('smooth', { durationSec: 8 });
    const highFirst = getCurveByPreset('highFirst', { durationSec: 8 });
    
    expect(bassSwap.durationSec).toBe(8);
    expect(freqSplit.durationSec).toBe(8);
    expect(smooth.durationSec).toBe(8);
    expect(highFirst.durationSec).toBe(8);
  });
});

describe('getEQAtProgress', () => {
  const keyframes: EQKeyframe[] = [
    { time: 0, bands: { low: 1, mid: 1, high: 1 } },
    { time: 0.5, bands: { low: 0, mid: 0.5, high: 1 } },
    { time: 1, bands: { low: 0, mid: 0, high: 0 } },
  ];

  it('returns first keyframe at progress 0', () => {
    const band = getEQAtProgress(keyframes, 0);
    expect(band.low).toBe(1);
    expect(band.mid).toBe(1);
    expect(band.high).toBe(1);
  });

  it('returns last keyframe at progress 1', () => {
    const band = getEQAtProgress(keyframes, 1);
    expect(band.low).toBe(0);
    expect(band.mid).toBe(0);
    expect(band.high).toBe(0);
  });

  it('interpolates between keyframes', () => {
    // At 0.25, should be between first and second keyframe
    const band = getEQAtProgress(keyframes, 0.25);
    
    expect(band.low).toBeLessThan(1);
    expect(band.low).toBeGreaterThan(0);
    expect(band.mid).toBeLessThan(1);
    expect(band.high).toBe(1); // High stays at 1 between 0 and 0.5
  });

  it('returns unity for empty keyframes', () => {
    const band = getEQAtProgress([], 0.5);
    expect(band.low).toBe(1);
    expect(band.mid).toBe(1);
    expect(band.high).toBe(1);
  });

  it('returns single keyframe for single-element array', () => {
    const singleKeyframe = [{ time: 0, bands: { low: 0.5, mid: 0.5, high: 0.5 } }];
    const band = getEQAtProgress(singleKeyframe, 0.7);
    expect(band.low).toBe(0.5);
  });

  it('handles progress beyond keyframe times', () => {
    const band = getEQAtProgress(keyframes, 1.5);
    // Should clamp to last keyframe
    expect(band.low).toBe(0);
  });
});
