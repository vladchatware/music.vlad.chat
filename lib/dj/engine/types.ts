/**
 * Engine Types
 * 
 * Types for the DJ engine state machine and transition planning.
 */

import type {
  DJTrack,
  DeckState,
  TransitionPlan,
  AnalysisSnapshot,
  BeatGrid,
  StructureMap,
  EnergyCurve,
  Normalized,
  AudioTimeSec,
  TimestampMs,
  CamelotKey,
  TrackCuePoints,
  PhraseType,
} from '../types';

// =============================================================================
// State Machine Types
// =============================================================================

/**
 * All possible DJ engine states
 */
export type DJStateType = 
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'cueing'
  | 'planned'
  | 'crossfading'
  | 'paused';

/**
 * Discriminated union of all DJ states
 */
export type DJState =
  | { readonly type: 'idle' }
  | { readonly type: 'loading'; readonly trackId: number; readonly deck: 'A' | 'B' }
  | { readonly type: 'ready'; readonly activeDeck: DeckSnapshot }
  | { readonly type: 'playing'; readonly activeDeck: DeckSnapshot; readonly analysis: AnalysisSnapshot }
  | { readonly type: 'cueing'; readonly activeDeck: DeckSnapshot; readonly cueDeck: DeckSnapshot; readonly analysis: AnalysisSnapshot }
  | { readonly type: 'planned'; readonly activeDeck: DeckSnapshot; readonly cueDeck: DeckSnapshot; readonly plan: TransitionPlan; readonly analysis: AnalysisSnapshot }
  | { readonly type: 'crossfading'; readonly outgoingDeck: DeckSnapshot; readonly incomingDeck: DeckSnapshot; readonly plan: TransitionPlan; readonly progress: Normalized }
  | { readonly type: 'paused'; readonly activeDeck: DeckSnapshot };

/**
 * Lightweight snapshot of deck state (for state machine)
 */
export interface DeckSnapshot {
  readonly id: 'A' | 'B';
  readonly track: DJTrack;
  readonly positionSec: AudioTimeSec;
  readonly beatGrid: BeatGrid | null;
  readonly structureMap: StructureMap | null;
  readonly energyCurve: EnergyCurve | null;
  readonly cuePoints?: TrackCuePoints;
  readonly analysisVersion?: string;
  readonly segments?: PerformanceSegment[];
}

export interface PerformanceSegment {
  readonly id: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly section: PhraseType;
  readonly energy: number;
  readonly energySlope: number;
  readonly rhythmicDensity?: number;
  readonly entryQuality?: number;
  readonly exitQuality?: number;
  readonly confidence?: number;
  readonly mirexMood?: Record<string, number> | null;
  readonly valence?: number | null;
  readonly arousal?: number | null;
  readonly vocalProbability?: number | null;
}

export interface DeckAnalysisMetadata {
  readonly analysisVersion?: string;
  readonly beatGrid?: BeatGrid;
  readonly structureMap?: StructureMap;
  readonly energyCurve: EnergyCurve;
  readonly cuePoints?: TrackCuePoints;
  readonly bpm?: number;
  readonly keySignature?: string;
  readonly camelotKey?: CamelotKey;
  readonly segments?: PerformanceSegment[];
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * All possible DJ engine events
 */
export type DJEventType =
  | 'LOAD_TRACK'
  | 'TRACK_LOADED'
  | 'TRACK_LOAD_FAILED'
  | 'PLAY'
  | 'PAUSE'
  | 'SEEK'
  | 'CUE_TRACK'
  | 'CUE_READY'
  | 'CUE_FAILED'
  | 'PLAN_TRANSITION'
  | 'START_CROSSFADE'
  | 'CROSSFADE_TICK'
  | 'CROSSFADE_COMPLETE'
  | 'CANCEL_TRANSITION'
  | 'ANALYSIS_UPDATE'
  | 'TRACK_ANALYSIS_READY'
  | 'RESET';

/**
 * Discriminated union of all DJ events
 */
export type DJEvent =
  | { readonly type: 'LOAD_TRACK'; readonly trackId: number; readonly deck?: 'A' | 'B' }
  | { readonly type: 'TRACK_LOADED'; readonly deck: DeckSnapshot }
  | { readonly type: 'TRACK_LOAD_FAILED'; readonly error: string }
  | { readonly type: 'PLAY' }
  | { readonly type: 'PAUSE' }
  | { readonly type: 'SEEK'; readonly positionSec: AudioTimeSec }
  | { readonly type: 'CUE_TRACK'; readonly trackId: number }
  | { readonly type: 'CUE_READY'; readonly deck: DeckSnapshot }
  | { readonly type: 'CUE_FAILED'; readonly error: string }
  | { readonly type: 'PLAN_TRANSITION'; readonly plan: TransitionPlan }
  | { readonly type: 'START_CROSSFADE' }
  | { readonly type: 'CROSSFADE_TICK'; readonly progress: Normalized }
  | { readonly type: 'CROSSFADE_COMPLETE' }
  | { readonly type: 'CANCEL_TRANSITION' }
  | { readonly type: 'ANALYSIS_UPDATE'; readonly analysis: AnalysisSnapshot }
  | {
      readonly type: 'TRACK_ANALYSIS_READY';
      readonly trackId: number;
      readonly analysis: DeckAnalysisMetadata;
    }
  | { readonly type: 'RESET' };

// =============================================================================
// Transition Planning Types
// =============================================================================

/**
 * Input for transition planning
 */
export interface TransitionPlanInput {
  readonly outgoingDeck: DeckSnapshot;
  readonly incomingDeck: DeckSnapshot;
  readonly currentTimeSec: AudioTimeSec;
  readonly analysis: AnalysisSnapshot;
}

/**
 * Options for transition planning
 */
export interface TransitionPlanOptions {
  /** Minimum crossfade duration in seconds */
  readonly minCrossfadeSec?: number;
  /** Maximum crossfade duration in seconds */
  readonly maxCrossfadeSec?: number;
  /** Preferred phrase length for alignment (in bars) */
  readonly preferredPhraseBars?: number;
  /** Whether to use harmonic matching */
  readonly useHarmonicMatching?: boolean;
  /** Whether to use tempo matching */
  readonly useTempoMatching?: boolean;
  /** EQ curve preset to use */
  readonly eqPreset?: 'bassSwap' | 'frequencySplit' | 'smooth' | 'highFirst';
}

// =============================================================================
// Default Values
// =============================================================================

export const DEFAULT_ANALYSIS_SNAPSHOT: AnalysisSnapshot = {
  bpm: null,
  bpmSource: 'fallback',
  section: 'unknown',
  overallEnergy: 0,
  bassEnergy: 0,
  stillDurationMs: 0,
  dropDetected: false,
  beatPhase: 0,
  timeToNextBeatMs: 0,
};

export const DEFAULT_TRANSITION_PLAN_OPTIONS: Required<TransitionPlanOptions> = {
  minCrossfadeSec: 4,
  maxCrossfadeSec: 32,
  preferredPhraseBars: 16,
  useHarmonicMatching: true,
  useTempoMatching: true,
  eqPreset: 'bassSwap',
};
