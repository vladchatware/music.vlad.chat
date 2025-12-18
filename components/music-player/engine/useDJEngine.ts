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

interface UseDJEngineOptions {
  isIOS: boolean;
  onRequestNextTrack?: () => Promise<void>;
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
  const { isIOS, onRequestNextTrack } = opts;
  
  // Initialize state with reducer
  const [engineState, dispatch] = useReducer(djEngineReducer, {
    djState: getInitialDJState(),
    isIOS,
  });
  
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
      
      // Don't trigger during crossfade - the outgoing deck ending is expected
      if (stateType === 'crossfading') return;
      
      // If track ended while cueing, mark it so we start crossfade immediately when ready
      if (stateType === 'cueing') {
        trackEndedWhileCueingRef.current = true;
      }
      
      // Request next track via callback (only if not already transitioning)
      if (onRequestNextTrack && stateType !== 'planned') {
        await onRequestNextTrack();
      }
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
  }, [getActiveDeckElement]);
  
  const pause = useCallback(() => {
    const deck = getActiveDeckElement();
    if (!deck) return;
    
    deck.pause();
    dispatch({ type: 'PAUSE' });
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
  }, [loadTrack, engineState.djState.type]);
  
  // ==========================================================================
  // Transition Management
  // ==========================================================================
  
  const planTransition = useCallback(() => {
    const state = engineState.djState;
    if (state.type !== 'cueing') return;
    
    const currentTime = getActiveDeckElement()?.currentTime ?? 0;
    
    const plan = createTransitionPlan({
      outgoingDeck: state.activeDeck,
      incomingDeck: state.cueDeck,
      currentTimeSec: currentTime,
      analysis: state.analysis,
    });
    
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
    
    // Start incoming deck
    incomingDeck.currentTime = 0;
    await incomingDeck.play();
    
    crossfadeStartTimeRef.current = outgoingDeck.currentTime;
    dispatch({ type: 'START_CROSSFADE' });
  }, [engineState.djState, getActiveDeckElement, getInactiveDeckElement, getActiveEQ, getInactiveEQ]);
  
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

    dispatch({ type: 'CROSSFADE_COMPLETE' });
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
        
        // Is this a good mix moment?
        const isGoodMixMoment = 
          section === 'breakdown' ||
          (section === 'culmination' && bassEnergy > 0.55) ||
          stillDuration > 900;
        
        // Near track end? Request early enough for a smooth crossfade
        const crossfadeDurationSec = 16 * barDurationSec;
        const requestLeadSec = Math.max(45, crossfadeDurationSec + 8);
        const trackDuration = deckToCheck.duration || 0;
        const nearTrackEnd = trackDuration > 20 && deckToCheck.currentTime > trackDuration - requestLeadSec;
        
        if (canAutoRevibe && (isGoodMixMoment || nearTrackEnd) && onRequestNextTrack) {
          autoRevibeAtMsRef.current = nowMs;
          revibeTriggeredRef.current = true;
          void onRequestNextTrack();
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
    
    // Dispatch for custom events
    dispatch,
  };
}
