/**
 * DJ Library - Shared Types
 * 
 * This module defines all shared types used across the DJ transition system.
 * All types are designed to be:
 * - Immutable (readonly where appropriate)
 * - Serializable (no functions or class instances)
 * - Deterministic (same inputs produce same outputs)
 */

// =============================================================================
// Time & Duration Types
// =============================================================================

/** Duration in milliseconds */
export type DurationMs = number;

/** Duration in seconds */
export type DurationSec = number;

/** Timestamp in milliseconds (performance.now() style) */
export type TimestampMs = number;

/** Audio time in seconds (HTMLMediaElement.currentTime style) */
export type AudioTimeSec = number;

/** Normalized value between 0 and 1 */
export type Normalized = number;

/** Playback rate multiplier (typically 0.92 - 1.08 for DJ use) */
export type PlaybackRate = number;

// =============================================================================
// Beat & Tempo Types
// =============================================================================

/** Beats per minute */
export type BPM = number;

/** Beat index (0-based) */
export type BeatIndex = number;

/** Bar index (0-based, assuming 4/4 time) */
export type BarIndex = number;

/** Phase within a beat cycle (0 = on beat, 0.5 = halfway, 1 = next beat) */
export type BeatPhase = number;

/**
 * A grid of beats for a track, used for tempo and phase matching.
 * Beat positions are in audio time (seconds from track start).
 */
export interface BeatGrid {
  /** BPM of the track */
  readonly bpm: BPM;
  /** Time signature numerator (typically 4) */
  readonly beatsPerBar: number;
  /** First detected downbeat position in seconds */
  readonly firstDownbeat: AudioTimeSec;
  /** Optional array of beat timestamps for variable tempo tracks */
  readonly beats?: readonly AudioTimeSec[];
  /** Confidence score for this beat grid (0-1) */
  readonly confidence: Normalized;
}

/**
 * Constraints for tempo matching
 */
export interface TempoConstraints {
  /** Minimum allowed playback rate (default: 0.92 = -8%) */
  readonly minRate: PlaybackRate;
  /** Maximum allowed playback rate (default: 1.08 = +8%) */
  readonly maxRate: PlaybackRate;
  /** Whether to allow key shifting with tempo (affects audio quality) */
  readonly preservePitch: boolean;
}

/**
 * Result of tempo matching between two tracks
 */
export interface TempoMatchResult {
  /** Playback rate for the target track to match source tempo */
  readonly targetPlaybackRate: PlaybackRate;
  /** Phase offset in milliseconds to align beats */
  readonly phaseOffsetMs: DurationMs;
  /** Confidence score for this match (0-1) */
  readonly confidence: Normalized;
  /** Whether tempo matching is possible within constraints */
  readonly feasible: boolean;
}

// =============================================================================
// Phrase & Structure Types
// =============================================================================

/**
 * Type of musical phrase/section
 */
export type PhraseType = 
  | 'intro'
  | 'verse'
  | 'buildup'
  | 'drop'
  | 'breakdown'
  | 'outro'
  | 'unknown';

/**
 * A musical phrase within a track
 */
export interface Phrase {
  /** Starting beat index */
  readonly startBeat: BeatIndex;
  /** Length in bars */
  readonly lengthBars: number;
  /** Type of phrase */
  readonly type: PhraseType;
  /** Average energy level (0-1) */
  readonly energy: Normalized;
  /** Start time in seconds */
  readonly startTime: AudioTimeSec;
  /** End time in seconds */
  readonly endTime: AudioTimeSec;
}

/**
 * A section grouping multiple phrases
 */
export interface Section {
  /** Section type (derived from dominant phrase type) */
  readonly type: PhraseType;
  /** Phrases within this section */
  readonly phrases: readonly Phrase[];
  /** Start time in seconds */
  readonly startTime: AudioTimeSec;
  /** End time in seconds */
  readonly endTime: AudioTimeSec;
  /** Average energy level (0-1) */
  readonly energy: Normalized;
}

/**
 * Complete structure map of a track
 */
export interface StructureMap {
  /** All detected phrases */
  readonly phrases: readonly Phrase[];
  /** Timestamps of phrase/section boundaries (downbeats) */
  readonly downbeats: readonly AudioTimeSec[];
  /** High-level sections */
  readonly sections: readonly Section[];
  /** Track duration in seconds */
  readonly duration: DurationSec;
}

// =============================================================================
// Harmonic Types (Camelot Wheel)
// =============================================================================

/**
 * Camelot wheel key notation (1A-12A for minor, 1B-12B for major)
 */
export type CamelotKey = 
  | '1A' | '2A' | '3A' | '4A' | '5A' | '6A' | '7A' | '8A' | '9A' | '10A' | '11A' | '12A'
  | '1B' | '2B' | '3B' | '4B' | '5B' | '6B' | '7B' | '8B' | '9B' | '10B' | '11B' | '12B';

/**
 * Harmonic relationship between two keys
 */
export type HarmonicRelationship =
  | 'same'        // Identical key (1.0 compatibility)
  | 'perfect5th'  // +7 semitones, same mode (0.95 compatibility)
  | 'perfect4th'  // -5 semitones, same mode (0.90 compatibility)
  | 'relative'    // Relative major/minor (0.85 compatibility)
  | 'parallel'    // Same root, different mode (0.75 compatibility)
  | 'adjacent'    // +/- 1 on Camelot wheel (0.70 compatibility)
  | 'clash';      // Dissonant relationship (< 0.5 compatibility)

/**
 * Result of harmonic compatibility analysis
 */
export interface HarmonicScore {
  /** Compatibility score (0-1) */
  readonly compatibility: Normalized;
  /** Type of harmonic relationship */
  readonly relationship: HarmonicRelationship;
  /** Suggested pitch shift in semitones to improve compatibility (-2 to +2) */
  readonly suggestedPitchShift: number;
  /** Whether mixing is recommended */
  readonly recommended: boolean;
}

// =============================================================================
// Energy Types
// =============================================================================

/**
 * Energy curve representing energy levels over time
 */
export interface EnergyCurve {
  /** Normalized energy samples (0-1) */
  readonly samples: Float32Array;
  /** Samples per second */
  readonly sampleRate: number;
  /** Indices of energy peaks */
  readonly peaks: readonly number[];
  /** Indices of energy valleys */
  readonly valleys: readonly number[];
  /** Track duration in seconds */
  readonly duration: DurationSec;
}

/**
 * Score for how well a transition would work between two tracks
 */
export interface TransitionScore {
  /** How well energy levels match at the transition point (0-1) */
  readonly energyMatch: Normalized;
  /** How well the energy momentum matches (rising/falling) (0-1) */
  readonly momentumMatch: Normalized;
  /** Score for variety vs monotony (0-1) */
  readonly contrastScore: Normalized;
  /** Overall weighted score (0-1) */
  readonly overall: Normalized;
}

// =============================================================================
// EQ Types
// =============================================================================

/**
 * 3-band EQ levels (gain multipliers, 0 = silent, 1 = unity)
 */
export interface EQBand {
  /** Low frequencies: 20-250 Hz */
  readonly low: Normalized;
  /** Mid frequencies: 250-4000 Hz */
  readonly mid: Normalized;
  /** High frequencies: 4000-20000 Hz */
  readonly high: Normalized;
}

/**
 * A keyframe in an EQ automation curve
 */
export interface EQKeyframe {
  /** Time offset from transition start (0-1, normalized to transition duration) */
  readonly time: Normalized;
  /** EQ band levels at this keyframe */
  readonly bands: EQBand;
}

/**
 * Complete EQ curve for a transition
 */
export interface EQCurve {
  /** Duration of the transition in seconds */
  readonly durationSec: DurationSec;
  /** Keyframes for the outgoing track */
  readonly outgoing: readonly EQKeyframe[];
  /** Keyframes for the incoming track */
  readonly incoming: readonly EQKeyframe[];
}

// =============================================================================
// Transition Types
// =============================================================================

/**
 * A beat boundary where a transition can start
 */
export interface BeatBoundary {
  /** Audio time in seconds */
  readonly timeSec: AudioTimeSec;
  /** Bar index at this boundary */
  readonly barIndex: BarIndex;
  /** Whether this is a phrase boundary (every 4, 8, or 16 bars typically) */
  readonly isPhraseBoundary: boolean;
  /** Phrase length if this is a phrase boundary */
  readonly phraseLength?: number;
}

/**
 * Complete transition plan
 */
export interface TransitionPlan {
  /** When to start the transition */
  readonly startBoundary: BeatBoundary;
  /** Duration of the crossfade in seconds */
  readonly crossfadeDurationSec: DurationSec;
  /** Tempo adjustment for the incoming track */
  readonly tempoAdjustment: TempoMatchResult;
  /** EQ curve to apply during transition */
  readonly eqCurve: EQCurve;
  /** Harmonic compatibility score */
  readonly harmonicScore: HarmonicScore;
  /** Energy transition score */
  readonly energyScore: TransitionScore;
  /** Overall plan quality (0-1) */
  readonly quality: Normalized;
  /** Timestamp when this plan was created */
  readonly createdAt: TimestampMs;
}

// =============================================================================
// Deck & Track Types
// =============================================================================

/**
 * Extended track information with DJ metadata
 */
export interface DJTrack {
  /** Track ID (from source platform) */
  readonly id: number;
  /** Track title */
  readonly title?: string;
  /** Artist name */
  readonly artist?: string;
  /** Genre */
  readonly genre?: string;
  /** BPM (from metadata or detected) */
  readonly bpm?: BPM;
  /** Key signature (e.g., "Am", "C#m", "F") */
  readonly keySignature?: string;
  /** Parsed Camelot key */
  readonly camelotKey?: CamelotKey;
  /** Duration in seconds */
  readonly duration?: DurationSec;
  /** Artwork URL */
  readonly artworkUrl?: string;
}

/**
 * State of a single deck
 */
export interface DeckState {
  /** Deck identifier */
  readonly id: 'A' | 'B';
  /** Currently loaded track */
  readonly track: DJTrack | null;
  /** Current playback position in seconds */
  readonly positionSec: AudioTimeSec;
  /** Current playback rate */
  readonly playbackRate: PlaybackRate;
  /** Whether the deck is playing */
  readonly isPlaying: boolean;
  /** Current volume (0-1) */
  readonly volume: Normalized;
  /** Current EQ settings */
  readonly eq: EQBand;
  /** Beat grid for the loaded track */
  readonly beatGrid: BeatGrid | null;
  /** Structure map for the loaded track */
  readonly structureMap: StructureMap | null;
  /** Energy curve for the loaded track */
  readonly energyCurve: EnergyCurve | null;
}

/**
 * Analysis snapshot at a point in time
 */
export interface AnalysisSnapshot {
  /** Current BPM (detected or from metadata) */
  readonly bpm: BPM | null;
  /** Source of BPM data */
  readonly bpmSource: 'metadata' | 'detected' | 'fallback';
  /** Current section type */
  readonly section: PhraseType;
  /** Current overall energy level (0-1) */
  readonly overallEnergy: Normalized;
  /** Current bass energy level (0-1) */
  readonly bassEnergy: Normalized;
  /** Time since last significant energy change */
  readonly stillDurationMs: DurationMs;
  /** Whether a drop was just detected */
  readonly dropDetected: boolean;
  /** Current beat phase (0-1) */
  readonly beatPhase: BeatPhase;
  /** Time to next beat in ms */
  readonly timeToNextBeatMs: DurationMs;
}

// =============================================================================
// Default Values
// =============================================================================

export const DEFAULT_TEMPO_CONSTRAINTS: TempoConstraints = {
  minRate: 0.92,
  maxRate: 1.08,
  preservePitch: true,
};

export const DEFAULT_EQ_BAND: EQBand = {
  low: 1,
  mid: 1,
  high: 1,
};

export const DEFAULT_BEAT_GRID: BeatGrid = {
  bpm: 120,
  beatsPerBar: 4,
  firstDownbeat: 0,
  confidence: 0,
};

export const FALLBACK_BPM: BPM = 120;
