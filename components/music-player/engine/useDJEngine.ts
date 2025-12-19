"use client";

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
    structureMap: null,
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
  const [engineState, dispatch] = useReducer(djEngineReducer, {
    djState: getInitialDJState(),
    isIOS,
  });

  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerARef = useRef<FFTAnalyzer | null>(null);
  const analyzerBRef = useRef<FFTAnalyzer | null>(null);
  const analyzerRef = useRef<FFTAnalyzer | null>(null);
  const bpmDetectorRef = useRef<BPMDetector | null>(null);
  const eqControllerARef = useRef<EQController | null>(null);
  const eqControllerBRef = useRef<EQController | null>(null);

  const transitionPlanRef = useRef<TransitionPlan | null>(null);
  const crossfadeStartTimeRef = useRef<number | null>(null);
  const activeDeckRef = useRef<'A' | 'B'>('A');

  const energyHistoryRef = useRef<number[]>([]);
  const energyHistoryStartTimeRef = useRef<number>(0);

  const autoRevibeAtMsRef = useRef<number>(0);
  const revibeTriggeredRef = useRef<boolean>(false);
  const trackEndedWhileCueingRef = useRef<boolean>(false);

  const { knobs, actions } = useMusicPlayerStore(
    useShallow((s) => ({
      knobs: s.knobs,
      actions: s.actions,
    }))
  );

  useEffect(() => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA || !deckB) return;
    if (!isIOS) {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextCtor();
      audioContextRef.current = ctx;

      const sourceA = ctx.createMediaElementSource(deckA);
      const sourceB = ctx.createMediaElementSource(deckB);

      const eqA = new EQController(ctx);
      const eqB = new EQController(ctx);

      eqA.connectSource(sourceA);
      eqA.connectDestination(ctx.destination);
      eqB.connectSource(sourceB);
      eqB.connectDestination(ctx.destination);

      eqControllerARef.current = eqA;
      eqControllerBRef.current = eqB;

      const analyzerA = new FFTAnalyzer(sourceA, ctx, 0);
      const analyzerB = new FFTAnalyzer(sourceB, ctx, 0);

      analyzerARef.current = analyzerA;
      analyzerBRef.current = analyzerB;
      analyzerRef.current = analyzerA;
    }

    bpmDetectorRef.current = new BPMDetector();

    return () => {
      analyzerARef.current?.toggleAnalyzer(false);
      analyzerBRef.current?.toggleAnalyzer(false);
      eqControllerARef.current?.dispose();
      eqControllerBRef.current?.dispose();
      audioContextRef.current?.close();
      // @ts-ignore
      window.obsstudio?.stopRecording();
    };
  }, [isIOS]);

  const getActiveDeckElement = useCallback(() => activeDeckRef.current === 'A' ? deckARef.current : deckBRef.current, []);
  const getInactiveDeckElement = useCallback(() => activeDeckRef.current === 'A' ? deckBRef.current : deckARef.current, []);
  const getActiveEQ = useCallback(() => activeDeckRef.current === 'A' ? eqControllerARef.current : eqControllerBRef.current, []);
  const getInactiveEQ = useCallback(() => activeDeckRef.current === 'A' ? eqControllerBRef.current : eqControllerARef.current, []);
  const getActiveAnalyzer = useCallback(() => activeDeckRef.current === 'A' ? analyzerARef.current : analyzerBRef.current, []);
  const getInactiveAnalyzer = useCallback(() => activeDeckRef.current === 'A' ? analyzerBRef.current : analyzerARef.current, []);

  // Sync knobs effect
  useEffect(() => {
    if (engineState.djState.type === 'crossfading') return;
    const eq = getActiveEQ();
    if (!eq) return;

    eq.setBand({ low: knobs.low, mid: knobs.mid, high: knobs.high });
    const now = eq.output.context.currentTime;
    eq.output.gain.setTargetAtTime(knobs.volume, now, 0.05);

    const nodes = eq.nodes;
    const qValue = 0.7 + knobs.resonance * 10;
    nodes.lowFilter.Q.setTargetAtTime(qValue, now, 0.05);
    nodes.highFilter.Q.setTargetAtTime(qValue, now, 0.05);
    nodes.midFilter.Q.setTargetAtTime(qValue, now, 0.05);
  }, [knobs, getActiveEQ, engineState.djState.type]);

  const play = useCallback(async () => {
    const deck = getActiveDeckElement();
    if (!deck || !deck.src) return;
    if (audioContextRef.current?.state === 'suspended') await audioContextRef.current.resume();
    await deck.play();
    dispatch({ type: 'PLAY' });
    // @ts-ignore
    window.obsstudio?.startRecording();
  }, [getActiveDeckElement]);

  const pause = useCallback(() => {
    const deck = getActiveDeckElement();
    if (!deck) return;
    deck.pause();
    dispatch({ type: 'PAUSE' });
    // @ts-ignore
    window.obsstudio?.stopRecording();
  }, [getActiveDeckElement]);

  const togglePlay = useCallback(async () => {
    const deck = getActiveDeckElement();
    if (!deck || !deck.src) return;
    deck.paused ? await play() : pause();
  }, [getActiveDeckElement, play, pause]);

  const loadTrack = useCallback(async (track: SoundCloudTrack, deckId: 'A' | 'B' = 'A') => {
    const djTrack = soundCloudToDJTrack(track);
    if (!djTrack) return;
    dispatch({ type: 'LOAD_TRACK', trackId: djTrack.id, deck: deckId });
    deckId === 'A' ? actions.setTrackA(track) : actions.setTrackB(track);
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
    dispatch({ type: 'TRACK_LOADED', deck: createDeckSnapshot('A', djTrack, 0, beatGrid, null) });
    actions.setActiveTrack(track);
  }, [loadTrack, actions]);

  const cueNextTrack = useCallback(async (track: SoundCloudTrack) => {
    const state = engineState.djState.type;
    if (state === 'crossfading' || state === 'cueing' || state === 'planned') return;

    const inactiveId = activeDeckRef.current === 'A' ? 'B' : 'A';
    await loadTrack(track, inactiveId);
    const djTrack = soundCloudToDJTrack(track);
    if (!djTrack) return;
    const beatGrid = constructBeatGridFromBpm(djTrack.bpm);
    dispatch({ type: 'CUE_READY', deck: createDeckSnapshot(inactiveId, djTrack, 0, beatGrid, null) });
  }, [loadTrack, engineState.djState.type]);

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

  const resetTransitionRefs = useCallback(() => {
    transitionPlanRef.current = null;
    crossfadeStartTimeRef.current = null;
    revibeTriggeredRef.current = false;
    autoRevibeAtMsRef.current = Date.now();
    trackEndedWhileCueingRef.current = false;
  }, []);

  const cancelTransition = useCallback(() => {
    resetTransitionRefs();
    const inactive = getInactiveDeckElement();
    if (inactive) {
      inactive.pause();
      inactive.currentTime = 0;
      inactive.playbackRate = 1.0;
    }
    getActiveEQ()?.reset();
    getInactiveEQ()?.reset();
    dispatch({ type: 'CANCEL_TRANSITION' });
  }, [resetTransitionRefs, getInactiveDeckElement, getActiveEQ, getInactiveEQ]);

  const startCrossfade = useCallback(async () => {
    if (crossfadeStartTimeRef.current !== null) return;
    crossfadeStartTimeRef.current = 0;
    const state = engineState.djState;
    if (state.type !== 'planned') {
      crossfadeStartTimeRef.current = null;
      return;
    }
    const outgoing = getActiveDeckElement();
    const incoming = getInactiveDeckElement();
    const outEQ = getActiveEQ();
    const inEQ = getInactiveEQ();
    if (!outgoing || !incoming) {
      crossfadeStartTimeRef.current = null;
      return;
    }
    const plan = state.plan;
    if (outEQ && inEQ) {
      outEQ.setCurve(plan.eqCurve);
      inEQ.setCurve(plan.eqCurve);
    }
    if (plan.tempoAdjustment.feasible) {
      incoming.playbackRate = plan.tempoAdjustment.targetPlaybackRate;
    }
    incoming.currentTime = 0;
    await incoming.play();
    crossfadeStartTimeRef.current = outgoing.currentTime;
    dispatch({ type: 'START_CROSSFADE' });
    // @ts-ignore
    window.obsstudio?.startRecording();
  }, [engineState.djState, getActiveDeckElement, getInactiveDeckElement, getActiveEQ, getInactiveEQ]);

  const completeCrossfade = useCallback(() => {
    const outgoing = getActiveDeckElement();
    const incoming = getInactiveDeckElement();
    if (outgoing) {
      outgoing.pause();
      outgoing.currentTime = 0;
      outgoing.playbackRate = 1.0;
    }
    if (incoming) incoming.playbackRate = 1.0;
    getActiveEQ()?.reset();
    getInactiveEQ()?.reset();
    const newActive = activeDeckRef.current === 'A' ? 'B' : 'A';
    activeDeckRef.current = newActive;
    analyzerRef.current = newActive === 'A' ? analyzerARef.current : analyzerBRef.current;

    const storeState = useMusicPlayerStore.getState();
    const nextTrack = newActive === 'A' ? storeState.trackA : storeState.trackB;
    if (nextTrack) actions.setActiveTrack(nextTrack);

    resetTransitionRefs();
    bpmDetectorRef.current?.reset();
    energyHistoryRef.current = [];
    dispatch({ type: 'CROSSFADE_COMPLETE' });
    // @ts-ignore
    window.obsstudio?.stopRecording();
    // @ts-ignore
    setTimeout(() => window.obsstudio?.startRecording(), 1000);
  }, [getActiveDeckElement, getInactiveDeckElement, getActiveEQ, getInactiveEQ, actions, resetTransitionRefs]);

  useEffect(() => {
    let rafId: number | null = null;
    const loop = () => {
      const detector = bpmDetectorRef.current;
      const isCrossfading = engineState.djState.type === 'crossfading';
      const deck = isCrossfading ? getInactiveDeckElement() : getActiveDeckElement();
      const analyzer = isCrossfading ? getInactiveAnalyzer() : getActiveAnalyzer();

      if (analyzer && detector && deck && !deck.paused) {
        const bass = analyzer.getEnergy('bass');
        const overall = analyzer.getEnergy('overall');
        const drop = detector.detectBeat(bass);
        energyHistoryRef.current.push(overall);
        if (energyHistoryRef.current.length > 3000) energyHistoryRef.current.shift();

        const bpm = detector.hasReliableBPM() ? detector.getBPM() : null;
        const still = detector.getCurrentStillDuration();
        let section: TrackSection = 'unknown';
        if (still > 500) section = 'breakdown';
        else if (overall > 0.6) section = 'culmination';
        else if (overall > 0.3) section = 'comeup';
        else section = 'intro';

        const analysis = sectionToAnalysis(section, bpm, bass, overall, still, drop, detector.getBeatPhase(), detector.getTimeToNextBeat());
        dispatch({ type: 'ANALYSIS_UPDATE', analysis });
        actions.setAnalysis({ bpm, bpmSource: bpm ? 'detector' : 'fallback', barDurationSec: bpm ? (60 / bpm) * 4 : null, section, overallEnergy: overall, bassEnergy: bass, stillDurationMs: still, dropDetected: drop });
        actions.setPlayback({ currentTimeSec: deck.currentTime, durationSec: deck.duration || 0, progress01: deck.duration ? Math.min(1, deck.currentTime / deck.duration) : 0 });

        const state = engineState.djState;
        const now = Date.now();
        const barDur = bpm ? (60 / bpm) * 4 : 8;
        const canRevibe = state.type === 'playing' && (now - autoRevibeAtMsRef.current > AUTO_REVIBE_COOLDOWN_MS) && deck.currentTime > AUTO_REVIBE_MIN_PLAY_SEC && !revibeTriggeredRef.current;
        const goodMoment = section === 'breakdown' || (section === 'culmination' && bass > 0.55) || still > 900;
        const lead = Math.max(45, (16 * barDur) + 8);
        const nearEnd = (deck.duration || 0) > 20 && deck.currentTime > (deck.duration || 0) - lead;

        if (canRevibe && (goodMoment || nearEnd) && onRequestNextTrack) {
          autoRevibeAtMsRef.current = now;
          revibeTriggeredRef.current = true;
          void onRequestNextTrack();
        }

        if (state.type === 'crossfading' && deck) {
          const progress = Math.min(1, deck.currentTime / state.plan.crossfadeDurationSec);
          getActiveEQ()?.tick(progress, true);
          getInactiveEQ()?.tick(progress, false);
          dispatch({ type: 'CROSSFADE_TICK', progress });
          actions.setTransition({ state: 'crossfading', progress01: progress, durationSec: state.plan.crossfadeDurationSec });
          if (progress >= 1) completeCrossfade();
        }

        if (state.type === 'planned' && transitionPlanRef.current && deck) {
          if (isGoodTransitionMoment(deck.currentTime, transitionPlanRef.current)) {
            void startCrossfade();
          }
        }
      }
      const stateForFallback = engineState.djState;
      const active = getActiveDeckElement();
      if (stateForFallback.type === 'planned' && active && (active.paused || active.ended)) {
        void startCrossfade();
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [engineState.djState, getActiveDeckElement, getInactiveDeckElement, getActiveEQ, getInactiveEQ, getActiveAnalyzer, getInactiveAnalyzer, actions, completeCrossfade, startCrossfade, onRequestNextTrack]);

  useEffect(() => {
    if (engineState.djState.type === 'cueing') planTransition();
  }, [engineState.djState.type, planTransition]);

  useEffect(() => {
    if (engineState.djState.type === 'planned' && trackEndedWhileCueingRef.current) {
      trackEndedWhileCueingRef.current = false;
      void startCrossfade();
    }
  }, [engineState.djState.type, startCrossfade]);

  useEffect(() => {
    const s = engineState.djState;
    if (s.type === 'planned') {
      actions.setTransition({ state: 'planned', progress01: 0, durationSec: s.plan.crossfadeDurationSec, plannedStartSec: s.plan.startBoundary.timeSec });
    } else if (['playing', 'idle', 'paused'].includes(s.type)) {
      actions.resetTransition();
    }
  }, [engineState.djState.type, engineState.djState, actions]);

  const p = useMemo(() => {
    switch (engineState.djState.type) {
      case 'idle': case 'loading': case 'ready': return 'needsGesture';
      case 'paused': return 'paused';
      case 'playing': return 'playing';
      case 'cueing': case 'planned': return 'cueingNext';
      case 'crossfading': return 'crossfading';
      default: return 'needsGesture';
    }
  }, [engineState.djState.type]);

  return {
    deckARef, deckBRef,
    djState: engineState.djState,
    phase: p,
    isPlaying: isTrackPlaying(engineState.djState),
    isTransitioning: isTransitionActive(engineState.djState),
    activeDeck: getActiveDeck(engineState.djState),
    transitionPlan: transitionPlanRef.current,
    trackEndedWhileCueing: trackEndedWhileCueingRef.current,
    analyzerRef, bpmDetectorRef,
    play, pause, togglePlay, loadInitialTrack, cueNextTrack, planTransition, startCrossfade, cancelTransition,
    dispatch,
  };
}
