/**
 * EQ Controller
 * 
 * Controls 3-band EQ for a deck using WebAudio API.
 */

import type { EQBand, EQCurve, Normalized } from '../types';
import type { EQNodes, EQFrequencyBands } from './types';
import { DEFAULT_FREQUENCY_BANDS } from './types';
import { getEQAtProgress } from './curves';
import { DEFAULT_EQ_BAND } from '../types';

/**
 * 3-band EQ controller for a single audio source.
 * 
 * Creates a chain of biquad filters:
 * input -> lowShelf -> peaking (mid) -> highShelf -> output
 */
export class EQController {
  private readonly _audioContext: AudioContext;
  private readonly _bands: EQFrequencyBands;
  private readonly _nodes: EQNodes;
  private _curve: EQCurve | null = null;
  private _currentBand: EQBand = { ...DEFAULT_EQ_BAND };
  
  constructor(
    audioContext: AudioContext,
    bands: EQFrequencyBands = DEFAULT_FREQUENCY_BANDS
  ) {
    this._audioContext = audioContext;
    this._bands = bands;
    
    // Create filter nodes
    const lowFilter = audioContext.createBiquadFilter();
    const midFilter = audioContext.createBiquadFilter();
    const highFilter = audioContext.createBiquadFilter();
    const output = audioContext.createGain();
    
    // Configure low shelf filter
    lowFilter.type = 'lowshelf';
    lowFilter.frequency.value = bands.low.max;
    lowFilter.gain.value = 0; // dB
    
    // Configure mid band peaking filter
    midFilter.type = 'peaking';
    midFilter.frequency.value = Math.sqrt(bands.mid.min * bands.mid.max); // Geometric mean
    midFilter.Q.value = 0.7;
    midFilter.gain.value = 0; // dB
    
    // Configure high shelf filter
    highFilter.type = 'highshelf';
    highFilter.frequency.value = bands.high.min;
    highFilter.gain.value = 0; // dB
    
    // Chain: low -> mid -> high -> output
    lowFilter.connect(midFilter);
    midFilter.connect(highFilter);
    highFilter.connect(output);
    
    this._nodes = { lowFilter, midFilter, highFilter, output };
  }
  
  /**
   * Get the EQ nodes for connecting to the audio graph.
   */
  get nodes(): EQNodes {
    return this._nodes;
  }
  
  /**
   * Get the input node (connect source to this).
   */
  get input(): BiquadFilterNode {
    return this._nodes.lowFilter;
  }
  
  /**
   * Get the output node (connect this to destination).
   */
  get output(): GainNode {
    return this._nodes.output;
  }
  
  /**
   * Get current EQ band values.
   */
  get currentBand(): EQBand {
    return this._currentBand;
  }
  
  /**
   * Connect a source node to this EQ.
   */
  connectSource(source: AudioNode): void {
    source.connect(this._nodes.lowFilter);
  }
  
  /**
   * Disconnect a source from this EQ.
   */
  disconnectSource(source: AudioNode): void {
    try {
      source.disconnect(this._nodes.lowFilter);
    } catch {
      // Node wasn't connected
    }
  }
  
  /**
   * Connect the output to a destination.
   */
  connectDestination(destination: AudioNode): void {
    this._nodes.output.connect(destination);
  }
  
  /**
   * Disconnect the output.
   */
  disconnectOutput(): void {
    try {
      this._nodes.output.disconnect();
    } catch {
      // No connections
    }
  }
  
  /**
   * Set the EQ curve to automate during transitions.
   */
  setCurve(curve: EQCurve | null): void {
    this._curve = curve;
  }
  
  /**
   * Convert a normalized gain (0-1) to decibels.
   * 0 = -Infinity (muted), 1 = 0dB, values > 1 = boost
   */
  private normalizedToDb(normalized: Normalized): number {
    if (normalized <= 0) return -96; // Effectively muted
    if (normalized >= 1) return 0;   // Unity gain
    
    // Use a logarithmic curve for natural volume perception
    // -24dB at 0.1, -12dB at 0.25, -6dB at 0.5, 0dB at 1.0
    return 20 * Math.log10(normalized);
  }
  
  /**
   * Set the EQ band values directly.
   */
  setBand(band: EQBand): void {
    this._currentBand = band;
    
    // Convert normalized values to dB for filters
    const lowDb = this.normalizedToDb(band.low);
    const midDb = this.normalizedToDb(band.mid);
    const highDb = this.normalizedToDb(band.high);
    
    // Apply to filters
    const now = this._audioContext.currentTime;
    this._nodes.lowFilter.gain.setValueAtTime(lowDb, now);
    this._nodes.midFilter.gain.setValueAtTime(midDb, now);
    this._nodes.highFilter.gain.setValueAtTime(highDb, now);
  }
  
  /**
   * Set individual band values.
   */
  setLow(value: Normalized): void {
    this.setBand({ ...this._currentBand, low: value });
  }
  
  setMid(value: Normalized): void {
    this.setBand({ ...this._currentBand, mid: value });
  }
  
  setHigh(value: Normalized): void {
    this.setBand({ ...this._currentBand, high: value });
  }
  
  /**
   * Reset EQ to flat (unity gain on all bands).
   */
  reset(): void {
    this.setBand({ low: 1, mid: 1, high: 1 });
    this._curve = null;
  }
  
  /**
   * Update EQ based on transition progress.
   * 
   * @param progress - Transition progress (0-1)
   * @param isOutgoing - Whether this is the outgoing track
   */
  tick(progress: Normalized, isOutgoing: boolean = true): void {
    if (!this._curve) return;
    
    const keyframes = isOutgoing ? this._curve.outgoing : this._curve.incoming;
    const band = getEQAtProgress(keyframes, progress);
    this.setBand(band);
  }
  
  /**
   * Schedule a transition using WebAudio automation.
   * More efficient than calling tick() on every frame.
   * 
   * @param startTime - AudioContext time to start
   * @param isOutgoing - Whether this is the outgoing track
   */
  scheduleTransition(startTime: number, isOutgoing: boolean = true): void {
    if (!this._curve) return;
    
    const keyframes = isOutgoing ? this._curve.outgoing : this._curve.incoming;
    const duration = this._curve.durationSec;
    
    for (const keyframe of keyframes) {
      const time = startTime + keyframe.time * duration;
      
      this._nodes.lowFilter.gain.linearRampToValueAtTime(
        this.normalizedToDb(keyframe.bands.low),
        time
      );
      this._nodes.midFilter.gain.linearRampToValueAtTime(
        this.normalizedToDb(keyframe.bands.mid),
        time
      );
      this._nodes.highFilter.gain.linearRampToValueAtTime(
        this.normalizedToDb(keyframe.bands.high),
        time
      );
    }
  }
  
  /**
   * Cancel any scheduled automation.
   */
  cancelScheduledTransition(): void {
    const now = this._audioContext.currentTime;
    
    this._nodes.lowFilter.gain.cancelScheduledValues(now);
    this._nodes.midFilter.gain.cancelScheduledValues(now);
    this._nodes.highFilter.gain.cancelScheduledValues(now);
  }
  
  /**
   * Clean up resources.
   */
  dispose(): void {
    this.disconnectOutput();
    
    try {
      this._nodes.lowFilter.disconnect();
      this._nodes.midFilter.disconnect();
      this._nodes.highFilter.disconnect();
    } catch {
      // Already disconnected
    }
  }
}

/**
 * Create an EQ controller for a deck.
 * 
 * @param audioContext - WebAudio context
 * @param source - Audio source node to EQ
 * @param destination - Where to route the output
 */
export function createEQController(
  audioContext: AudioContext,
  source?: AudioNode,
  destination?: AudioNode
): EQController {
  const controller = new EQController(audioContext);
  
  if (source) {
    controller.connectSource(source);
  }
  
  if (destination) {
    controller.connectDestination(destination);
  } else {
    controller.connectDestination(audioContext.destination);
  }
  
  return controller;
}
