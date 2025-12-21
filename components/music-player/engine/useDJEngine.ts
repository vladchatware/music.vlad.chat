"use client";

/**
 * useDJEngine Hook
 * 
 * A React hook that integrates the new DJ architecture with the existing
 * music player infrastructure. This provides a bridge between the pure
 * DJ library functions and the React/DOM world.
 * 
 * Key design principles:
 * - State is managed through the DJ state machine
 * - Side effects are executed via a controlled effect queue
 * - Analysis is performed through dedicated analyzers
 * - All decisions go through the transition planner
 */

import { useCallback, useEffect, useMemo, useRef, useReducer } from "react";
import { useShallow } from "zustand/react/shallow";

// DJ Library imports
import {
  type DJState,
  type DJEvent,
  type DJTrack,
  type DeckSnapshot,
  type TransitionPlan,
  type AnalysisSnapshot,
  type BeatGrid,
  type EnergyCurve,
  type CamelotKey,
  djReducer,
  getInitialDJState,
  isTrackPlaying,
  isTransitionActive,
  getActiveDeck,
  createTransitionPlan,
  isGoodTransitionMoment,
  calculateCrossfadeProgress,
  constructBeatGridFromBpm,
  analyzeEnergy,
  EQController,
  createBassSwapCurve,
  DEFAULT_ANALYSIS_SNAPSHOT,
  // Harmonic & tempo matching
  parseKey,
  getCompatibility,
  isTempoMatchFeasible,
  // Agent controls
  useAgentDJStore,
  type AgentDJSettings,
  type VibeDirection,
  type MixIntensity,
  mapAgentSettingsToTransitionOptions,
  isGoodTransitionMomentForVibe,
} from "@/lib/dj";

// Existing infrastructure imports
import FFTAnalyzer from "@/lib/analyzers/ftt";
import { BPMDetector } from "@/lib/analyzers/bpm-detector";
import { useMusicPlayerStore, type TrackSection } from "../store/useMusicPlayerStore";
import type { SoundCloudTrack } from "../types";

// =============================================================================
// Types
// =============================================================================

// Auto-revibe timing constants
const AUTO_REVIBE_COOLDOWN_MS = 45000;
const AUTO_REVIBE_MIN_PLAY_SEC = 30;

// Scheduled action from AI
interface ScheduledAction {
  atSec: number;
  action: string;
  params?: Record<string, any>;
  executed: boolean;
}

// Compatibility analysis result for incoming track
export interface TrackCompatibility {
  isGoodMatch: boolean;
  score: number; // 0-1, higher is better
  issues: string[]; // Human-readable issues
  suggestions: string[]; // Suggestions for AI
  harmonicScore: number;
  tempoScore: number;
  energyScore: number;
  optimalTransitionPoint: number; // Suggested exit point on current track (seconds)
  analyzedStartPosition: number; // Optimal start position on incoming track
}

interface UseDJEngineOptions {
  isIOS: boolean;
  onRequestNextTrack?: () => Promise<void>;
  onTrackAnalyzed?: (compatibility: TrackCompatibility) => void;
}

// Track info passed to analyzeIncomingTrack for accurate compatibility
interface TrackInfo {
  bpm?: number;
  key_signature?: string;
  title?: string;
}

interface DJEngineState {
  djState: DJState;
  isIOS: boolean;
}

// =============================================================================
// Reducer Wrapper
// =============================================================================

function djEngineReducer(
  state: DJEngineState,
  action: DJEvent
): DJEngineState {
  const result = djReducer(state.djState, action);
  // Side effects are handled separately via useEffect
  // Here we just update state
  return {
    ...state,
    djState: result.state,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function soundCloudToDJTrack(track: SoundCloudTrack | null): DJTrack | null {
  if (!track) return null;
  return {
    id: track.id,
    title: track.title,
    artist: track.user?.username || track.user?.full_name,
    genre: track.genre,
    bpm: track.bpm,
    keySignature: track.key_signature,
    artworkUrl: track.artwork_url,
  };
}

function createDeckSnapshot(
  id: 'A' | 'B',
  track: DJTrack,
  positionSec: number,
  beatGrid: BeatGrid | null,
  energyCurve: EnergyCurve | null
): DeckSnapshot {
  return {
    id,
    track,
    positionSec,
    beatGrid: beatGrid ?? constructBeatGridFromBpm(track.bpm),
    structureMap: null, // TODO: Implement structure analysis
    energyCurve,
  };
}

function sectionToAnalysis(
  section: TrackSection,
  bpm: number | null,
  bassEnergy: number,
  overallEnergy: number,
  stillDurationMs: number,
  dropDetected: boolean,
  beatPhase: number,
  timeToNextBeatMs: number
): AnalysisSnapshot {
  return {
    bpm,
    bpmSource: bpm ? 'detected' : 'fallback',
    section: section as any,
    overallEnergy,
    bassEnergy,
    stillDurationMs,
    dropDetected,
    beatPhase,
    timeToNextBeatMs,
  };
}

// =============================================================================
// Main Hook
// =============================================================================

export function useDJEngine(opts: UseDJEngineOptions) {
  const { isIOS, onRequestNextTrack, onTrackAnalyzed } = opts;
  // Initialize state with reducer
  const [engineState, dispatch] = useReducer(djEngineReducer, {
    djState: getInitialDJState(),
    isIOS,
  });
  
  // Track compatibility state for cued track
  const trackCompatibilityRef = useRef<TrackCompatibility | null>(null);
  // Refs for audio elements and Web Audio nodes
  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerARef = useRef<FFTAnalyzer | null>(null);
  const analyzerBRef = useRef<FFTAnalyzer | null>(null);
  const analyzerRef = useRef<FFTAnalyzer | null>(null); // Points to active deck's analyzer
  const bpmDetectorRef = useRef<BPMDetector | null>(null);
  const eqControllerARef = useRef<EQController | null>(null);
  const eqControllerBRef = useRef<EQController | null>(null);
  // Transition state refs
  const transitionPlanRef = useRef<TransitionPlan | null>(null);
  const crossfadeStartTimeRef = useRef<number | null>(null);
  const activeDeckRef = useRef<'A' | 'B'>('A');

  // Energy history for curve building
  const energyHistoryRef = useRef<number[]>([]);
  const energyHistoryStartTimeRef = useRef<number>(0);

  // Auto-revibe tracking
  const autoRevibeAtMsRef = useRef<number>(0);
  const revibeTriggeredRef = useRef<boolean>(false);

  // Track ended while cueing - enables immediate crossfade when cued track loads
  const trackEndedWhileCueingRef = useRef<boolean>(false);

  // Scheduled actions from AI for precise timestamp-based execution
  const scheduledActionsRef = useRef<ScheduledAction[]>([]);

  // Ref to hold startCrossfade function (to avoid circular dependency)
  const startCrossfadeRef = useRef<(() => Promise<void>) | null>(null);

  // Connect to existing store for compatibility
  const { actions } = useMusicPlayerStore(
    useShallow((s) => ({
      actions: s.actions,
    }))
  );

  // ==========================================================================
  // Audio Context & Analyzer Setup
  // ==========================================================================

  useEffect(() => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA || !deckB) return;
    if (!isIOS) {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextCtor();
      audioContextRef.current = ctx;

      deckA.crossOrigin = "anonymous";
      deckB.crossOrigin = "anonymous";

      const sourceA = ctx.createMediaElementSource(deckA);
      const sourceB = ctx.createMediaElementSource(deckB);

      // Create EQ controllers
      const eqA = new EQController(ctx);
      const eqB = new EQController(ctx);

      // Connect: source -> EQ -> destination
      eqA.connectSource(sourceA);
      eqA.connectDestination(ctx.destination);

      eqB.connectSource(sourceB);
      eqB.connectDestination(ctx.destination);

      eqControllerARef.current = eqA;
      eqControllerBRef.current = eqB;

      // Create separate analyzers for each deck with volume=0
      // (the EQ path handles actual audio output, these are just for analysis)
      const analyzerA = new FFTAnalyzer(sourceA, ctx, 0);
      const analyzerB = new FFTAnalyzer(sourceB, ctx, 0);

      analyzerARef.current = analyzerA;
      analyzerBRef.current = analyzerB;

      // Point analyzerRef to the initial active deck (A)
      analyzerRef.current = analyzerA;
    }

    bpmDetectorRef.current = new BPMDetector();

    return () => {
      analyzerARef.current?.toggleAnalyzer(false);
      analyzerBRef.current?.toggleAnalyzer(false);
      eqControllerARef.current?.dispose();
      eqControllerBRef.current?.dispose();
      audioContextRef.current?.close();

      // @ts-ignore OBS
      window.obsstudio?.stopRecording();
    };
  }, [isIOS]);

  // ==========================================================================
  // Track Ended Handler
  // ==========================================================================

  // Use ref to avoid stale closure in event handler
  const djStateTypeRef = useRef<string>(engineState.djState.type);
  useEffect(() => {
    djStateTypeRef.current = engineState.djState.type;
  }, [engineState.djState.type]);
  useEffect(() => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA || !deckB) return;
    const handleEnded = async (e: Event) => {
      const audio = e.target as HTMLAudioElement;
      const isAActive = activeDeckRef.current === 'A';
      const currentDeck = isAActive ? deckA : deckB;
      const stateType = djStateTypeRef.current;

      // Only handle if this is the active deck ending
      if (audio !== currentDeck) return;

      // Don't trigger during crossfade or if transition is planned - we want continuous recording
      if (stateType === 'crossfading' || stateType === 'planned') return;

      // If track ended while cueing, mark it so we start crossfade immediately when ready
      if (stateType === 'cueing') {
        trackEndedWhileCueingRef.current = true;
      }

      // Request next track via callback (only if not already transitioning)
      if (onRequestNextTrack) {
        await onRequestNextTrack();
      }

      // @ts-ignore OBS
      window.obsstudio?.stopRecording();
    };

    deckA.addEventListener('ended', handleEnded);
    deckB.addEventListener('ended', handleEnded);

    return () => {
      deckA.removeEventListener('ended', handleEnded);
      deckB.removeEventListener('ended', handleEnded);
    };
  }, [onRequestNextTrack]);

  // ==========================================================================
  // Deck Helpers
  // ==========================================================================

  const getActiveDeckElement = useCallback((): HTMLAudioElement | null => {
    return activeDeckRef.current === 'A' ? deckARef.current : deckBRef.current;
  }, []);

  const getInactiveDeckElement = useCallback((): HTMLAudioElement | null => {
    return activeDeckRef.current === 'A' ? deckBRef.current : deckARef.current;
  }, []);

  const getActiveEQ = useCallback((): EQController | null => {
    return activeDeckRef.current === 'A'
      ? eqControllerARef.current
      : eqControllerBRef.current;
  }, []);

  const getInactiveEQ = useCallback((): EQController | null => {
    return activeDeckRef.current === 'A'
      ? eqControllerBRef.current
      : eqControllerARef.current;
  }, []);

  const getActiveAnalyzer = useCallback((): FFTAnalyzer | null => {
    return activeDeckRef.current === 'A'
      ? analyzerARef.current
      : analyzerBRef.current;
  }, []);

  const getInactiveAnalyzer = useCallback((): FFTAnalyzer | null => {
    return activeDeckRef.current === 'A'
      ? analyzerBRef.current
      : analyzerARef.current;
  }, []);

  // ==========================================================================
  // Agent DJ Controls Integration
  // ==========================================================================

  useEffect(() => {
    // Subscribe to agent DJ settings changes and apply them to the engine
    const unsubscribe = useAgentDJStore.subscribe((state) => {
      const settings = state.settings;
      
      // Apply EQ settings to deck controllers
      const eqA = eqControllerARef.current;
      const eqB = eqControllerBRef.current;
      
      if (eqA) {
        eqA.setBand({
          low: settings.eq.deckA.low,
          mid: settings.eq.deckA.mid,
          high: settings.eq.deckA.high,
        });
      }
      
      if (eqB) {
        eqB.setBand({
          low: settings.eq.deckB.low,
          mid: settings.eq.deckB.mid,
          high: settings.eq.deckB.high,
        });
      }
      
      // Apply tempo adjustment to active deck
      const activeDeck = activeDeckRef.current === 'A' ? deckARef.current : deckBRef.current;
      if (activeDeck && settings.tempoAdjustment !== 0) {
        // Tempo adjustment is stored as -0.08 to +0.08, apply as playback rate multiplier
        const newRate = 1 + settings.tempoAdjustment;
        activeDeck.playbackRate = newRate;
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, []);

  // ==========================================================================
  // Playback Controls
  // ==========================================================================

  const play = useCallback(async () => {
    const deck = getActiveDeckElement();
    if (!deck || !deck.src) return;

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    await deck.play();
    dispatch({ type: 'PLAY' });

    // @ts-ignore OBS
    window.obsstudio?.startRecording();
  }, [getActiveDeckElement]);

  const pause = useCallback(() => {
    const deck = getActiveDeckElement();
    if (!deck) return;

    deck.pause();
    dispatch({ type: 'PAUSE' });

    // @ts-ignore OBS
    window.obsstudio?.stopRecording();
  }, [getActiveDeckElement]);

  const togglePlay = useCallback(async () => {
    const deck = getActiveDeckElement();
    if (!deck || !deck.src) return;

    if (deck.paused) {
      await play();
    } else {
      pause();
    }
  }, [getActiveDeckElement, play, pause]);

  // ==========================================================================
  // Track Loading
  // ==========================================================================

  const loadTrack = useCallback(async (
    track: SoundCloudTrack,
    deckId: 'A' | 'B' = 'A'
  ) => {
    const djTrack = soundCloudToDJTrack(track);
    if (!djTrack) return;

    dispatch({ type: 'LOAD_TRACK', trackId: djTrack.id, deck: deckId });

    // Update legacy store for compatibility
    if (deckId === 'A') {
      actions.setTrackA(track);
    } else {
      actions.setTrackB(track);
    }
    // Reset energy history when loading new track
    if (deckId === activeDeckRef.current) {
      energyHistoryRef.current = [];
      energyHistoryStartTimeRef.current = performance.now();
      bpmDetectorRef.current?.reset();
    }
  }, [actions]);

  const loadInitialTrack = useCallback(async (track: SoundCloudTrack) => {
    await loadTrack(track, 'A');
    activeDeckRef.current = 'A';

    const djTrack = soundCloudToDJTrack(track);
    if (!djTrack) return;

    const beatGrid = constructBeatGridFromBpm(djTrack.bpm);
    const deckSnapshot = createDeckSnapshot('A', djTrack, 0, beatGrid, null);

    dispatch({ type: 'TRACK_LOADED', deck: deckSnapshot });
    actions.setActiveTrack(track);
  }, [loadTrack, actions]);

  // Ref to store analyzed start position for incoming track
  const analyzedStartPositionRef = useRef<number>(0);
  
  // Analyze the incoming track for compatibility and find optimal positions
  // Now accepts explicit track info to avoid store timing issues
  const analyzeIncomingTrack = useCallback(async (incomingTrackInfo?: TrackInfo): Promise<TrackCompatibility> => {
    const activeDeck = getActiveDeckElement();
    const inactiveDeck = getInactiveDeckElement();
    const activeAnalyzer = getActiveAnalyzer();
    const inactiveAnalyzer = getInactiveAnalyzer();
    const inactiveEQ = getInactiveEQ();
    
    const storeState = useMusicPlayerStore.getState();
    const activeTrackData = activeDeckRef.current === 'A' ? storeState.trackA : storeState.trackB;
    // Use explicit track info if provided, otherwise fall back to store
    const incomingTrackData = incomingTrackInfo || (activeDeckRef.current === 'A' ? storeState.trackB : storeState.trackA);
    
    const issues: string[] = [];
    const suggestions: string[] = [];
    let harmonicScore = 0.5;
    let tempoScore = 0.5;
    let energyScore = 0.5;
    let optimalStart = 0;
    let optimalTransitionPoint = activeDeck?.duration ? activeDeck.duration * 0.8 : 180; // Default: 80% of track
    
    // 1. Harmonic compatibility check
    const activeKey = (activeTrackData as any)?.key_signature;
    const incomingKey = incomingTrackInfo?.key_signature || (incomingTrackData as any)?.key_signature;
    
    if (activeKey && incomingKey) {
      const activeCamelot = parseKey(activeKey);
      const incomingCamelot = parseKey(incomingKey);
      
      if (activeCamelot && incomingCamelot) {
        const harmonic = getCompatibility(activeCamelot, incomingCamelot);
        harmonicScore = harmonic.compatibility;
        
        if (!harmonic.recommended) {
          issues.push(`Key clash: ${activeKey} → ${incomingKey} (${harmonic.relationship})`);
          if (harmonic.suggestedPitchShift !== 0) {
            suggestions.push(`Consider pitch shift of ${harmonic.suggestedPitchShift} semitones`);
          }
          suggestions.push('Consider picking a track in a compatible key');
        }
      }
    } else {
      suggestions.push('Key information missing - harmonic compatibility unknown');
    }
    
    // 2. Tempo compatibility check
    const activeBpm = (activeTrackData as any)?.bpm || bpmDetectorRef.current?.getBPM();
    const incomingBpm = incomingTrackInfo?.bpm || (incomingTrackData as any)?.bpm;
    
    if (activeBpm && incomingBpm) {
      const tempoFeasible = isTempoMatchFeasible(activeBpm, incomingBpm);
      const bpmDiff = Math.abs(activeBpm - incomingBpm);
      const bpmRatio = Math.min(activeBpm, incomingBpm) / Math.max(activeBpm, incomingBpm);
      
      // Score based on how close the BPMs are (within ±8% is great)
      tempoScore = tempoFeasible ? Math.max(0.3, 1 - (bpmDiff / activeBpm) * 2) : 0.2;
      
      if (!tempoFeasible) {
        issues.push(`Large tempo gap: ${activeBpm} → ${incomingBpm} BPM (${bpmDiff.toFixed(0)} difference)`);
        suggestions.push('Consider a track with similar BPM');
      } else if (bpmDiff > 10) {
        issues.push(`Tempo adjustment needed: ${bpmDiff.toFixed(1)} BPM difference`);
      }
    }
    
    // 3. Analyze incoming track for optimal start position (find end of intro)
    if (inactiveDeck && inactiveAnalyzer && inactiveDeck.duration) {
      // Mute during analysis
      if (inactiveEQ) {
        inactiveEQ.setBand({ low: 0, mid: 0, high: 0 });
      }
      
      inactiveDeck.playbackRate = 4.0;
      inactiveDeck.currentTime = 0;
      
      try {
        await inactiveDeck.play();
        
        // Analyze for up to 3 seconds real-time (= 12 seconds of audio at 4x)
        let foundEnergy = false;
        const analysisStartTime = performance.now();
        const maxAnalysisMs = 3000;
        
        await new Promise<void>((resolve) => {
          const analyzeFrame = () => {
            const elapsed = performance.now() - analysisStartTime;
            const energy = inactiveAnalyzer.getEnergy('overall');
            const bassEnergy = inactiveAnalyzer.getEnergy('bass');
            
            // Store energy for comparison
            energyScore = Math.max(energyScore, energy);
            
            // Find end of intro (first high-energy section)
            if (!foundEnergy && (energy > 0.3 || bassEnergy > 0.4)) {
              foundEnergy = true;
              optimalStart = Math.max(0, inactiveDeck.currentTime - 2);
            }
            
            if (elapsed < maxAnalysisMs && inactiveDeck.currentTime < 60) {
              requestAnimationFrame(analyzeFrame);
            } else {
              resolve();
            }
          };
          requestAnimationFrame(analyzeFrame);
        });
        
        // Cleanup
        inactiveDeck.pause();
        inactiveDeck.currentTime = 0;
        inactiveDeck.playbackRate = 1.0;
        if (inactiveEQ) inactiveEQ.reset();
        
        if (!foundEnergy && inactiveDeck.duration > 60) {
          // Long intro, suggest skipping
          optimalStart = 30;
          suggestions.push(`Long intro detected - will skip to ${optimalStart}s`);
        }
        
      } catch (err) {
        console.warn('[DJ Engine] Track analysis failed:', err);
        inactiveDeck.pause();
        inactiveDeck.currentTime = 0;
        inactiveDeck.playbackRate = 1.0;
        if (inactiveEQ) inactiveEQ.reset();
      }
    }
    
    // 4. Calculate optimal transition point on current track
    // Find phrase boundaries before the outro
    if (activeDeck && activeDeck.duration && activeBpm) {
      const barDuration = (60 / activeBpm) * 4;
      const trackDuration = activeDeck.duration;
      const currentTime = activeDeck.currentTime;
      
      // Find next 8-bar or 16-bar boundary
      const barsPlayed = currentTime / barDuration;
      const next8Bar = Math.ceil(barsPlayed / 8) * 8 * barDuration;
      const next16Bar = Math.ceil(barsPlayed / 16) * 16 * barDuration;
      
      // Prefer transitioning around 75-85% of track, on a phrase boundary
      const idealTransitionZone = { start: trackDuration * 0.7, end: trackDuration * 0.9 };
      
      if (next16Bar >= idealTransitionZone.start && next16Bar <= idealTransitionZone.end) {
        optimalTransitionPoint = next16Bar;
      } else if (next8Bar >= idealTransitionZone.start && next8Bar <= idealTransitionZone.end) {
        optimalTransitionPoint = next8Bar;
      } else {
        // Just use 80% of track
        optimalTransitionPoint = trackDuration * 0.8;
      }
      
      // Make sure we have enough time (at least 20 seconds from now)
      if (optimalTransitionPoint - currentTime < 20) {
        const nextBoundary = next16Bar > currentTime + 20 ? next16Bar : next8Bar + 16 * barDuration;
        optimalTransitionPoint = Math.min(nextBoundary, trackDuration * 0.9);
      }
    }
    
    analyzedStartPositionRef.current = optimalStart;
    
    // 5. Calculate overall score
    const overallScore = (harmonicScore * 0.4) + (tempoScore * 0.4) + (energyScore * 0.2);
    const isGoodMatch = overallScore >= 0.5 && issues.length <= 1;
    
    if (!isGoodMatch) {
      suggestions.push('This track may not mix well - consider an alternative');
    }
    
    const compatibility: TrackCompatibility = {
      isGoodMatch,
      score: overallScore,
      issues,
      suggestions,
      harmonicScore,
      tempoScore,
      energyScore,
      optimalTransitionPoint,
      analyzedStartPosition: optimalStart,
    };
    
    trackCompatibilityRef.current = compatibility;
    
    console.log(`[DJ Engine] Track compatibility: score=${(overallScore * 100).toFixed(0)}%, ` +
      `harmonic=${(harmonicScore * 100).toFixed(0)}%, tempo=${(tempoScore * 100).toFixed(0)}%, ` +
      `start=${optimalStart.toFixed(1)}s, transition=${optimalTransitionPoint.toFixed(1)}s`);
    if (issues.length > 0) console.log(`[DJ Engine] Issues:`, issues);
    
    // Notify callback
    if (onTrackAnalyzed) {
      onTrackAnalyzed(compatibility);
    }
    
    return compatibility;
  }, [getActiveDeckElement, getInactiveDeckElement, getActiveAnalyzer, getInactiveAnalyzer, getInactiveEQ, onTrackAnalyzed]);

  const cueNextTrack = useCallback(async (track: SoundCloudTrack) => {
    // CRITICAL: Don't cue during crossfade - it would disrupt the incoming deck!
    const currentState = engineState.djState.type;
    if (currentState === 'crossfading' || currentState === 'cueing' || currentState === 'planned') {
      return;
    }

    const inactiveDeckId = activeDeckRef.current === 'A' ? 'B' : 'A';
    await loadTrack(track, inactiveDeckId);

    const djTrack = soundCloudToDJTrack(track);
    if (!djTrack) return;

    const beatGrid = constructBeatGridFromBpm(djTrack.bpm);
    const deckSnapshot = createDeckSnapshot(inactiveDeckId, djTrack, 0, beatGrid, null);

    dispatch({ type: 'CUE_READY', deck: deckSnapshot });
    
    // Start analyzing the incoming track to find optimal start position
    // Pass the track info directly to avoid store timing issues
    void analyzeIncomingTrack({
      bpm: (track as any).bpm,
      key_signature: (track as any).key_signature,
      title: (track as any).title,
    });
  }, [loadTrack, engineState.djState.type, analyzeIncomingTrack]);

  // ==========================================================================
  // Transition Management
  // ==========================================================================

  const planTransition = useCallback(() => {
    const state = engineState.djState;
    if (state.type !== 'cueing') return;

    const currentTime = getActiveDeckElement()?.currentTime ?? 0;
    
    // Get agent settings and map to transition options
    const agentSettings = useAgentDJStore.getState().settings;
    const transitionOptions = mapAgentSettingsToTransitionOptions(agentSettings);

    const plan = createTransitionPlan(
      {
        outgoingDeck: state.activeDeck,
        incomingDeck: state.cueDeck,
        currentTimeSec: currentTime,
        analysis: state.analysis,
      },
      transitionOptions
    );

    transitionPlanRef.current = plan;
    dispatch({ type: 'PLAN_TRANSITION', plan });
  }, [engineState.djState, getActiveDeckElement]);

  // Helper to reset all transition-related refs
  const resetTransitionRefs = useCallback(() => {
    transitionPlanRef.current = null;
    crossfadeStartTimeRef.current = null;
    revibeTriggeredRef.current = false;
    autoRevibeAtMsRef.current = Date.now();
    trackEndedWhileCueingRef.current = false;
  }, []);

  const cancelTransition = useCallback(() => {
    // Reset transition refs to allow future auto-revibe
    resetTransitionRefs();

    // Reset playback rate on inactive deck in case it was modified
    const inactiveDeck = getInactiveDeckElement();
    if (inactiveDeck) {
      inactiveDeck.pause();
      inactiveDeck.currentTime = 0;
      inactiveDeck.playbackRate = 1.0;
    }

    // Reset EQ on both decks
    getActiveEQ()?.reset();
    getInactiveEQ()?.reset();

    dispatch({ type: 'CANCEL_TRANSITION' });
  }, [resetTransitionRefs, getInactiveDeckElement, getActiveEQ, getInactiveEQ]);

  // ==========================================================================
  // Scheduled Actions from AI
  // ==========================================================================

  const scheduleActions = useCallback((actions: Array<{ atSec: number; action: string; params?: Record<string, any> }>) => {
    // Add new actions with executed flag
    const newActions: ScheduledAction[] = actions.map(a => ({
      ...a,
      executed: false,
    }));
    // Merge with existing scheduled actions (in case AI adds more during transition)
    scheduledActionsRef.current = [...scheduledActionsRef.current, ...newActions];
    console.log(`[DJ Engine] Scheduled ${actions.length} actions`);
  }, []);

  const executeScheduledAction = useCallback((action: ScheduledAction) => {
    console.log(`[DJ Engine] Executing scheduled action: ${action.action} at ${action.atSec}s`, action.params);
    const agentActions = useAgentDJStore.getState().actions;
    
    switch (action.action) {
      case 'player':
        // This will be handled by the AI calling the player tool separately
        // The scheduler just tracks timing
        break;
        
      case 'startCrossfade':
        if (engineState.djState.type === 'planned' && startCrossfadeRef.current) {
          void startCrossfadeRef.current();
        }
        break;
        
      case 'setEQ': {
        const params = action.params || {};
        const deck = params.deck === 'cued' ? 'cued' : 'active';
        agentActions.setEQ(deck, {
          low: params.low,
          mid: params.mid,
          high: params.high,
        });
        break;
      }
        
      case 'setFilter': {
        const params = action.params || {};
        const deck = params.deck === 'cued' ? 'cued' : 'active';
        agentActions.setFilter(deck, {
          type: params.filterType || 'lowpass',
          frequency: params.frequency || 1000,
          resonance: params.resonance || 1,
          enabled: true,
        });
        break;
      }
        
      case 'setTempo':
        if (action.params?.tempoAdjust !== undefined) {
          agentActions.setTempoAdjustment(action.params.tempoAdjust);
        }
        break;
        
      case 'setVibe':
        if (action.params?.vibe) {
          agentActions.setVibe(action.params.vibe);
        }
        break;
        
      case 'setMixIntensity':
        if (action.params?.intensity) {
          agentActions.setMixIntensity(action.params.intensity);
        }
        break;
        
      case 'swapBass': {
        // Quick bass swap - cut bass on active, boost on incoming
        const activeEQ = getActiveEQ();
        const inactiveEQ = getInactiveEQ();
        if (activeEQ && inactiveEQ) {
          activeEQ.setBand({ low: 0 });
          inactiveEQ.setBand({ low: 1 });
        }
        break;
      }
      
      case 'cutTrack': {
        // Hard cut - immediately stop and mute the outgoing track
        const outgoingDeck = getActiveDeckElement();
        const outgoingEQ = getActiveEQ();
        if (outgoingDeck) {
          outgoingDeck.pause();
          outgoingDeck.currentTime = 0;
        }
        if (outgoingEQ) {
          outgoingEQ.setBand({ low: 0, mid: 0, high: 0 });
        }
        break;
      }
        
      default:
        console.warn(`[DJ Engine] Unknown scheduled action: ${action.action}`);
    }
  }, [engineState.djState.type, getActiveEQ, getInactiveEQ]);

  const startCrossfade = useCallback(async () => {
    // Guard against re-entry - check and set atomically
    if (crossfadeStartTimeRef.current !== null) return;
    crossfadeStartTimeRef.current = 0; // Mark as starting immediately to prevent re-entry
    const state = engineState.djState;
    if (state.type !== 'planned') {
      crossfadeStartTimeRef.current = null; // Reset if state is not valid
      return;
    }
    const outgoingDeck = getActiveDeckElement();
    const incomingDeck = getInactiveDeckElement();
    const outgoingEQ = getActiveEQ();
    const incomingEQ = getInactiveEQ();
    if (!outgoingDeck || !incomingDeck) {
      crossfadeStartTimeRef.current = null; // Reset if decks not available
      return;
    }
    // Set up EQ curves
    const plan = state.plan;
    if (outgoingEQ && incomingEQ) {
      outgoingEQ.setCurve(plan.eqCurve);
      incomingEQ.setCurve(plan.eqCurve);
    }
    // Apply playback rate for tempo matching
    if (plan.tempoAdjustment.feasible) {
      incomingDeck.playbackRate = plan.tempoAdjustment.targetPlaybackRate;
    }

    // Determine start position: AI override > analyzed position > 0
    const storeState = useMusicPlayerStore.getState();
    const incomingTrack = activeDeckRef.current === 'A' ? storeState.trackB : storeState.trackA;
    const aiStartAtSec = (incomingTrack as any)?._startAtSec;
    const analyzedStart = analyzedStartPositionRef.current;
    const startAtSec = aiStartAtSec ?? analyzedStart ?? 0;
    
    console.log(`[DJ Engine] Starting incoming track at ${startAtSec.toFixed(1)}s (AI: ${aiStartAtSec}, analyzed: ${analyzedStart})`);
    incomingDeck.currentTime = startAtSec;
    await incomingDeck.play();

    crossfadeStartTimeRef.current = outgoingDeck.currentTime;
    dispatch({ type: 'START_CROSSFADE' });

    // @ts-ignore OBS
    window.obsstudio?.startRecording();
  }, [engineState.djState, getActiveDeckElement, getInactiveDeckElement, getActiveEQ, getInactiveEQ]);

  // Keep ref updated for scheduled actions to use
  useEffect(() => {
    startCrossfadeRef.current = startCrossfade;
  }, [startCrossfade]);

  const completeCrossfade = useCallback(() => {
    const outgoingDeck = getActiveDeckElement();
    const incomingDeck = getInactiveDeckElement();
    const outgoingEQ = getActiveEQ();
    const incomingEQ = getInactiveEQ();
    // Stop outgoing deck and reset its state
    if (outgoingDeck) {
      outgoingDeck.pause();
      outgoingDeck.currentTime = 0;
      outgoingDeck.playbackRate = 1.0; // Reset playback rate
    }
    // Reset incoming deck's playback rate (it's now the active deck)
    if (incomingDeck) {
      incomingDeck.playbackRate = 1.0;
    }

    // Reset EQ
    outgoingEQ?.reset();
    incomingEQ?.reset();

    // Swap active deck
    const newActiveDeck = activeDeckRef.current === 'A' ? 'B' : 'A';
    activeDeckRef.current = newActiveDeck;

    // Switch analyzer to the new active deck
    analyzerRef.current = newActiveDeck === 'A'
      ? analyzerARef.current
      : analyzerBRef.current;

    // Update activeTrack in legacy store to the new deck's track
    const storeState = useMusicPlayerStore.getState();
    const newActiveTrack = newActiveDeck === 'A' ? storeState.trackA : storeState.trackB;
    if (newActiveTrack) {
      actions.setActiveTrack(newActiveTrack);
    }
    // Reset transition state
    transitionPlanRef.current = null;
    crossfadeStartTimeRef.current = null;
    bpmDetectorRef.current?.reset();
    energyHistoryRef.current = [];
    revibeTriggeredRef.current = false; // Reset for next auto-revibe
    autoRevibeAtMsRef.current = Date.now(); // Reset cooldown timer for new track
    scheduledActionsRef.current = []; // Clear scheduled actions for new track

    dispatch({ type: 'CROSSFADE_COMPLETE' });

    // @ts-ignore OBS
    window.obsstudio?.stopRecording();
    // @ts-ignore OBS
    setTimeout(() => window.obsstudio?.startRecording(), 1000);
  }, [getActiveDeckElement, getInactiveDeckElement, getActiveEQ, getInactiveEQ, actions]);

  // ==========================================================================
  // Analysis Loop
  // ==========================================================================

  useEffect(() => {
    let rafId: number | null = null;

    const analysisLoop = () => {
      const detector = bpmDetectorRef.current;
      const isCrossfading = engineState.djState.type === 'crossfading';

      // During crossfade, check the incoming deck (which is playing), not outgoing
      const activeDeck = getActiveDeckElement();
      const incomingDeck = getInactiveDeckElement();
      const deckToCheck = isCrossfading ? incomingDeck : activeDeck;

      // Use the analyzer for the deck we're checking
      // During crossfade, use the incoming deck's analyzer
      const analyzer = isCrossfading ? getInactiveAnalyzer() : getActiveAnalyzer();

      if (analyzer && detector && deckToCheck && !deckToCheck.paused) {
        const bassEnergy = analyzer.getEnergy('bass');
        const overallEnergy = analyzer.getEnergy('overall');

        // Update BPM detector
        const dropDetected = detector.detectBeat(bassEnergy);

        // Collect energy history
        energyHistoryRef.current.push(overallEnergy);
        if (energyHistoryRef.current.length > 3000) { // ~5 minutes at 10fps
          energyHistoryRef.current.shift();
        }
        // Get beat information
        const bpm = detector.hasReliableBPM() ? detector.getBPM() : null;
        const beatPhase = detector.getBeatPhase();
        const timeToNextBeat = detector.getTimeToNextBeat();
        const stillDuration = detector.getCurrentStillDuration();
        // Classify section based on energy
        let section: TrackSection = 'unknown';
        if (stillDuration > 500) {
          section = 'breakdown';
        } else if (overallEnergy > 0.6) {
          section = 'culmination';
        } else if (overallEnergy > 0.3) {
          section = 'comeup';
        } else {
          section = 'intro';
        }
        // Create analysis snapshot
        const analysis = sectionToAnalysis(
          section,
          bpm,
          bassEnergy,
          overallEnergy,
          stillDuration,
          dropDetected,
          beatPhase,
          timeToNextBeat
        );

        // Update state
        dispatch({ type: 'ANALYSIS_UPDATE', analysis });

        // Update legacy store
        actions.setAnalysis({
          bpm,
          bpmSource: bpm ? 'detector' : 'fallback',
          barDurationSec: bpm ? (60 / bpm) * 4 : null,
          section,
          overallEnergy,
          bassEnergy,
          stillDurationMs: stillDuration,
          dropDetected,
        });
        // Update playback info
        actions.setPlayback({
          currentTimeSec: deckToCheck.currentTime,
          durationSec: deckToCheck.duration || 0,
          progress01: deckToCheck.duration ? Math.min(1, deckToCheck.currentTime / deckToCheck.duration) : 0,
        });
        // =======================================================================
        // Auto-revibe logic: request next track at good DJ moments
        // =======================================================================
        const state = engineState.djState;
        const nowMs = Date.now();
        const barDurationSec = bpm ? (60 / bpm) * 4 : 8; // default 8s if no BPM
        // Can we trigger auto-revibe?
        const isNotTransitioning = state.type === 'playing';
        const cooldownPassed = nowMs - autoRevibeAtMsRef.current > AUTO_REVIBE_COOLDOWN_MS;
        const playedEnough = deckToCheck.currentTime > AUTO_REVIBE_MIN_PLAY_SEC;
        const canAutoRevibe = isNotTransitioning && cooldownPassed && playedEnough && !revibeTriggeredRef.current;

        // Is this a good mix moment? Use agent settings for vibe-aware detection
        const agentSettings = useAgentDJStore.getState().settings;
        const isGoodMixMoment = isGoodTransitionMomentForVibe(
          overallEnergy,
          bassEnergy,
          section,
          dropDetected,
          agentSettings
        );

        // Near track end? Request early enough for a smooth crossfade
        // Early trigger to allow: cue → analyze → validate → (reject?) → plan → execute
        // We need at least 2-3 minutes of lead time for the full workflow
        const trackDuration = deckToCheck.duration || 0;
        
        // Trigger at 30-35% into the track to give maximum time for analysis and potential rejection
        const earlyTriggerPoint = trackDuration > 120 && deckToCheck.currentTime > trackDuration * 0.30;
        
        // Also trigger if we're running out of time (backup)
        const intensityMultiplier = agentSettings.intensity === 'aggressive' ? 0.5 :
                                    agentSettings.intensity === 'smooth' ? 2 : 1;
        const crossfadeDurationSec = 16 * barDurationSec * intensityMultiplier;
        const aiLatencyBuffer = 45;
        const requestLeadSec = Math.max(90, crossfadeDurationSec + aiLatencyBuffer + 20);
        const nearTrackEnd = trackDuration > 20 && deckToCheck.currentTime > trackDuration - requestLeadSec;
        
        const shouldTrigger = earlyTriggerPoint || nearTrackEnd;
        if (canAutoRevibe && (isGoodMixMoment || shouldTrigger) && onRequestNextTrack) {
          autoRevibeAtMsRef.current = nowMs;
          revibeTriggeredRef.current = true;
          void onRequestNextTrack();
        }
        
        // =======================================================================
        // Execute scheduled actions at precise timestamps
        // =======================================================================
        const currentTimeSec = deckToCheck.currentTime;
        for (const scheduledAction of scheduledActionsRef.current) {
          if (!scheduledAction.executed && currentTimeSec >= scheduledAction.atSec) {
            executeScheduledAction(scheduledAction);
            scheduledAction.executed = true;
          }
        }
        
        // Handle crossfade progress
        if (state.type === 'crossfading' && incomingDeck) {
          // Use incoming deck's currentTime directly as it starts at 0
          const progress = Math.min(1, incomingDeck.currentTime / state.plan.crossfadeDurationSec);

          // Update EQ based on progress
          getActiveEQ()?.tick(progress, true);
          getInactiveEQ()?.tick(progress, false);

          dispatch({ type: 'CROSSFADE_TICK', progress });

          // Sync to store for UI visualization (transitionHighlight)
          actions.setTransition({
            state: 'crossfading',
            progress01: progress,
            durationSec: state.plan.crossfadeDurationSec,
          });
          if (progress >= 1) {
            completeCrossfade();
          }
        }
        // Check if we should start transition
        if (state.type === 'planned' && transitionPlanRef.current && activeDeck) {
          if (isGoodTransitionMoment(activeDeck.currentTime, transitionPlanRef.current)) {
            void startCrossfade();
          }
        }
      }
      // FALLBACK: If we're in "planned" state but active deck has ended/paused, start immediately
      // The guard inside startCrossfade prevents re-entry
      const stateForFallback = engineState.djState;
      if (stateForFallback.type === 'planned' && activeDeck && (activeDeck.paused || activeDeck.ended)) {
        void startCrossfade();
      }

      rafId = requestAnimationFrame(analysisLoop);
    };

    rafId = requestAnimationFrame(analysisLoop);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    engineState.djState,
    getActiveDeckElement,
    getInactiveDeckElement,
    getActiveEQ,
    getInactiveEQ,
    getActiveAnalyzer,
    getInactiveAnalyzer,
    actions,
    completeCrossfade,
    startCrossfade,
    executeScheduledAction,
  ]);

  // ==========================================================================
  // Auto Transition Planning
  // ==========================================================================

  useEffect(() => {
    if (engineState.djState.type === 'cueing') {
      // Auto-plan when a track is cued
      planTransition();
    }
  }, [engineState.djState.type, planTransition]);

  // ==========================================================================
  // Immediate Crossfade When Track Ended While Cueing
  // ==========================================================================

  useEffect(() => {
    // If we enter 'planned' state and the track ended while we were cueing,
    // start crossfade immediately instead of waiting for a beat boundary
    if (engineState.djState.type === 'planned' && trackEndedWhileCueingRef.current) {
      trackEndedWhileCueingRef.current = false; // Reset before starting
      void startCrossfade();
    }
  }, [engineState.djState.type, startCrossfade]);

  // ==========================================================================
  // Sync Transition State to Store
  // ==========================================================================

  useEffect(() => {
    const stateType = engineState.djState.type;

    if (stateType === 'planned') {
      // Sync planned state to store for UI visualization
      const plan = (engineState.djState as { plan: { crossfadeDurationSec: number; startBoundary: { timeSec: number } } }).plan;
      actions.setTransition({
        state: 'planned',
        progress01: 0,
        durationSec: plan.crossfadeDurationSec,
        plannedStartSec: plan.startBoundary.timeSec,
      });
    } else if (stateType === 'playing' || stateType === 'idle' || stateType === 'paused') {
      // Reset transition state when not transitioning
      actions.resetTransition();
    }
  }, [engineState.djState.type, engineState.djState, actions]);

  // ==========================================================================
  // Derived State
  // ==========================================================================

  const isPlayingState = isTrackPlaying(engineState.djState);
  const isTransitioning = isTransitionActive(engineState.djState);
  const activeDeckSnapshot = getActiveDeck(engineState.djState);

  const phase = useMemo(() => {
    switch (engineState.djState.type) {
      case 'idle':
      case 'loading':
      case 'ready':
        return 'needsGesture';
      case 'paused':
        return 'paused';
      case 'playing':
        return 'playing';
      case 'cueing':
      case 'planned':
        return 'cueingNext';
      case 'crossfading':
        return 'crossfading';
      default:
        return 'needsGesture';
    }
  }, [engineState.djState.type]);

  // ==========================================================================
  // Return Value
  // ==========================================================================

  // Getter for current track compatibility
  const getTrackCompatibility = useCallback(() => {
    return trackCompatibilityRef.current;
  }, []);

  return {
    // Element refs
    deckARef,
    deckBRef,
    // State
    djState: engineState.djState,
    phase,
    isPlaying: isPlayingState,
    isTransitioning,
    activeDeck: activeDeckSnapshot,
    transitionPlan: transitionPlanRef.current,
    trackEndedWhileCueing: trackEndedWhileCueingRef.current,
    trackCompatibility: trackCompatibilityRef.current,

    // Analysis refs
    analyzerRef,
    bpmDetectorRef,

    // Actions
    play,
    pause,
    togglePlay,
    loadInitialTrack,
    cueNextTrack,
    planTransition,
    startCrossfade,
    cancelTransition,
    scheduleActions,
    getTrackCompatibility,
    // Dispatch for custom events
    dispatch,
  };
}
