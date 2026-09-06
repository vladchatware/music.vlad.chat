"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

import {
  type DJState,
  isTrackPlaying,
  isTransitionActive,
  getActiveDeck,
} from "@/lib/dj";
import {
  TRACK_ANALYSIS_VERSION,
  type TrackAnalysis,
} from "@/lib/trackAnalysis";

import { playbackDebug } from "@/lib/playbackDebug";
import type { AudioBeatSnapshot } from "@/lib/live/dancerMotion";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import {
  createDJEngineStore,
  djEngineReducer,
  getAnalysisTrackIds,
  toDeckAnalysisMetadata,
  type DeckId,
  type HoldLoopCache,
  type UseDJEngineOptions,
} from "./runtimeModel";
import { useDeckAudioGraph } from "./useDeckAudioGraph";
import { useDeckEvents } from "./useDeckEvents";
import { useEngineDiagnostics } from "./useEngineDiagnostics";
import { usePlaybackLoop } from "./usePlaybackLoop";
import { useTransitionController } from "./useTransitionController";
import { runDetached } from "./asyncSafety";

export function useDJEngine(opts: UseDJEngineOptions) {
  const { isIOS, onRequestNextTrack, autoCueConfig } = opts;

  const engineStoreRef = useRef<ReturnType<typeof createDJEngineStore> | null>(null);
  if (engineStoreRef.current === null) {
    engineStoreRef.current = createDJEngineStore();
  }
  const engineState = useStore(engineStoreRef.current);
  const dispatch = useCallback((event: Parameters<typeof djEngineReducer>[1]) => {
    engineStoreRef.current?.setState((state) => djEngineReducer(state, event));
  }, []);

  const analysisEnabled = process.env.NEXT_PUBLIC_DJ_ANALYSIS_ENABLED === "true";
  const [analysisTrackIdA, analysisTrackIdB] = getAnalysisTrackIds(engineState.djState);
  const trackAnalysisA = useQuery(
    api.trackAnalysis.getBySoundCloudId,
    analysisEnabled && analysisTrackIdA !== null
      ? { trackId: String(analysisTrackIdA), analysisVersion: TRACK_ANALYSIS_VERSION }
      : "skip",
  ) as TrackAnalysis | null | undefined;
  const trackAnalysisB = useQuery(
    api.trackAnalysis.getBySoundCloudId,
    analysisEnabled && analysisTrackIdB !== null
      ? { trackId: String(analysisTrackIdB), analysisVersion: TRACK_ANALYSIS_VERSION }
      : "skip",
  ) as TrackAnalysis | null | undefined;

  useEffect(() => {
    if (!trackAnalysisA || analysisTrackIdA === null) return;
    dispatch({
      type: "TRACK_ANALYSIS_READY",
      trackId: analysisTrackIdA,
      analysis: toDeckAnalysisMetadata(trackAnalysisA),
    });
  }, [analysisTrackIdA, engineState.djState.type, trackAnalysisA]);

  useEffect(() => {
    if (!trackAnalysisB || analysisTrackIdB === null) return;
    dispatch({
      type: "TRACK_ANALYSIS_READY",
      trackId: analysisTrackIdB,
      analysis: toDeckAnalysisMetadata(trackAnalysisB),
    });
  }, [analysisTrackIdB, engineState.djState.type, trackAnalysisB]);

  const activeDeckRef = useRef<DeckId>("A");
  const revibeTriggeredRef = useRef(false);
  const holdLoopCacheRef = useRef<Record<DeckId, HoldLoopCache | null>>({
    A: null,
    B: null,
  });

  const energyHistoryRef = useRef<number[]>([]);
  const audioEnergyRef = useRef(0);
  const audioBeatRef = useRef<AudioBeatSnapshot>({ phase: 0, strength: 0, tracked: false });
  const {
    diagnosticsRef,
    pendingTransitionMetricRef,
    finalizeCurrentListeningSegment,
    ensureListeningSegment,
    recordTransitionOutcome,
  } = useEngineDiagnostics();
  const djStateTypeRef = useRef<DJState["type"]>(engineState.djState.type);
  useEffect(() => {
    djStateTypeRef.current = engineState.djState.type;
  }, [engineState.djState.type]);

  const { actions } = useMusicPlayerStore(
    useShallow((s) => ({
      actions: s.actions,
    })),
  );

  const logEngine = useCallback(
    (event: string, payload?: Record<string, unknown>) => {
      playbackDebug(event, {
        ...payload,
        djState: djStateTypeRef.current,
        activeDeck: activeDeckRef.current,
      });
    },
    [],
  );

  const audioGraph = useDeckAudioGraph(isIOS, activeDeckRef, logEngine);
  const {
    engineRef,
    analyzerRef,
    bpmDetectorRef,
    deckStatusRef,
    getDeckState,
    getActiveDeckState,
    getActiveAnalyzer,
    getInactiveAnalyzer,
  } = audioGraph;

  useEffect(() => {
    actions.acquire();
    return () => {
      actions.release();
    };
  }, [actions]);

  const {
    transitionPlanRef,
    effectiveCrossfadeDurationSecRef,
    plannedAtMsRef,
    plannedReplanCountRef,
    crossfadeStartTimeRef,
    trackEndedWhileCueingRef,
    performanceLoopRepetitionsRef,
    resetTransitionRefs,
    play,
    pause,
    togglePlay,
    loadInitialTrack,
    cueNextTrack,
    planTransition,
    replanPlannedTransition,
    startCrossfade,
    completeCrossfade,
  } = useTransitionController({
    state: engineState.djState,
    dispatch,
    actions,
    audio: audioGraph,
    djStateTypeRef,
    holdLoopCacheRef,
    energyHistoryRef,
    revibeTriggeredRef,
    diagnosticsRef,
    pendingTransitionMetricRef,
    ensureListeningSegment,
    finalizeCurrentListeningSegment,
    recordTransitionOutcome,
    logEngine,
  });

  useDeckEvents({
    engineRef,
    deckStatusRef,
    activeDeckRef,
    bpmDetectorRef,
    holdLoopCacheRef,
    djStateTypeRef,
    trackEndedWhileCueingRef,
    revibeTriggeredRef,
    diagnosticsRef,
    ensureListeningSegment,
    finalizeCurrentListeningSegment,
    logEngine,
    onTransitionComplete: completeCrossfade,
    onRequestNextTrack,
  });

  usePlaybackLoop({
    state: engineState.djState,
    dispatch,
    actions,
    bpmDetectorRef,
    energyHistoryRef,
    audioEnergyRef,
    audioBeatRef,
    revibeTriggeredRef,
    transitionPlanRef,
    effectiveCrossfadeDurationSecRef,
    crossfadeStartTimeRef,
    plannedAtMsRef,
    plannedReplanCountRef,
    performanceLoopRepetitionsRef,
    diagnosticsRef,
    engineRef,
    getDeckState,
    getActiveDeckState,
    getActiveAnalyzer,
    getInactiveAnalyzer,
    onRequestNextTrack,
    autoCueConfig,
    logEngine,
    completeCrossfade,
    replanPlannedTransition,
    resetTransitionRefs,
    startCrossfade,
    recordTransitionOutcome,
  });

  const previousStateTypeRef = useRef<DJState["type"]>(engineState.djState.type);
  useEffect(() => {
    const previousState = previousStateTypeRef.current;
    if (previousState !== engineState.djState.type) {
      logEngine("engine.state_change", {
        from: previousState,
        to: engineState.djState.type,
      });
      previousStateTypeRef.current = engineState.djState.type;
    }
  }, [engineState.djState.type, logEngine]);

  useEffect(() => {
    if (engineState.djState.type === "cueing") {
      planTransition();
    }
  }, [engineState.djState.type, planTransition]);

  useEffect(() => {
    if (engineState.djState.type === "planned" && trackEndedWhileCueingRef.current) {
      trackEndedWhileCueingRef.current = false;
      runDetached(startCrossfade(), (error) => {
        logEngine("engine.crossfade.start_rejected", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }, [engineState.djState.type, startCrossfade]);

  useEffect(() => {
    const state = engineState.djState;
    if (state.type === "planned") {
      const plan = state.plan;
      actions.setTransition({
        state: "planned",
        progress01: 0,
        durationSec: plan.crossfadeDurationSec,
        plannedStartSec: plan.startBoundary.timeSec,
      });
    } else if (
      state.type === "playing" ||
      state.type === "idle" ||
      state.type === "paused" ||
      state.type === "ready"
    ) {
      actions.resetTransition();
    }
  }, [actions, engineState.djState]);

  const isPlaying = isTrackPlaying(engineState.djState);
  const isTransitioning = isTransitionActive(engineState.djState);
  const activeDeck = getActiveDeck(engineState.djState);
  const activePlaybackRate = getActiveDeckState().playbackRate;

  const clearPendingNextTrackRequest = useCallback((reason: string) => {
    if (!revibeTriggeredRef.current) return false;
    revibeTriggeredRef.current = false;
    logEngine("engine.next_track_request.cleared", { reason });
    return true;
  }, [logEngine]);

  const phase = useMemo(() => {
    switch (engineState.djState.type) {
      case "idle":
      case "loading":
      case "ready":
        return "needsGesture";
      case "paused":
        return "paused";
      case "playing":
        return "playing";
      case "cueing":
      case "planned":
        return "cueingNext";
      case "crossfading":
        return "crossfading";
      default:
        return "needsGesture";
    }
  }, [engineState.djState.type]);

  return {
    djState: engineState.djState,
    phase,
    audioReady: audioGraph.audioReady,
    isPlaying,
    isTransitioning,
    activeDeck,
    activePlaybackRate,
    analyzerRef,
    bpmDetectorRef,
    broadcastAudioStreamRef: audioGraph.broadcastAudioStreamRef,
    audioEnergyRef,
    audioBeatRef,
    diagnosticsRef,

    play,
    pause,
    togglePlay,
    loadInitialTrack,
    cueNextTrack,
    clearPendingNextTrackRequest,
  };
}
