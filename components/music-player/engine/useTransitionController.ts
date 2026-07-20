"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import {
  constructBeatGridFromBpm,
  type DJEvent,
  type DJPerformancePlan,
  type DJState,
  type TransitionPlan,
} from "@/lib/dj";
import type { SoundCloudTrack } from "../types";
import {
  useMusicPlayerStore,
  type MusicPlayerStore,
} from "../store/useMusicPlayerStore";
import {
  DEFAULT_ABRUPT_MISMATCH_THRESHOLD,
  computeHandoffEnergyMismatch,
  isAbruptTransition,
} from "./continuityMetrics";
import {
  createDeckSnapshot,
  getFiniteDurationSec,
  resolveTransitionPlan,
  withEffectiveTrackDuration,
  type DeckId,
  type EngineDiagnostics,
  type HoldLoopCache,
} from "./runtimeModel";
import type { DeckAudioGraph } from "./useDeckAudioGraph";
import { useDeckTransport } from "./useDeckTransport";
import { runDetached } from "./asyncSafety";

type EngineLogger = (event: string, payload?: Record<string, unknown>) => void;

type TransitionControllerOptions = {
  state: DJState;
  dispatch: (event: DJEvent) => void;
  actions: MusicPlayerStore["actions"];
  audio: DeckAudioGraph;
  djStateTypeRef: MutableRefObject<DJState["type"]>;
  holdLoopCacheRef: MutableRefObject<Record<DeckId, HoldLoopCache | null>>;
  energyHistoryRef: MutableRefObject<number[]>;
  revibeTriggeredRef: MutableRefObject<boolean>;
  diagnosticsRef: MutableRefObject<EngineDiagnostics>;
  pendingTransitionMetricRef: MutableRefObject<{
    handoffEnergyMismatch: number;
    isAbruptTransition: boolean;
  } | null>;
  ensureListeningSegment: (atMs: number) => void;
  finalizeCurrentListeningSegment: (atMs: number) => void;
  recordTransitionOutcome: (outcome: "completed" | "aborted" | "failed_start") => void;
  logEngine: EngineLogger;
};

export function useTransitionController(options: TransitionControllerOptions) {
  const {
    state,
    dispatch,
    actions,
    audio,
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
  } = options;
  const {
    activeDeckRef,
    bpmDetectorRef,
    deckStatusRef,
    getActiveAnalyzer,
    getActiveEQ,
    getDeckElement,
    getInactiveAnalyzer,
    getInactiveDeckId,
    getInactiveEQ,
    waitForDeckCanPlay,
  } = audio;
  const engineState = { djState: state };
  const transitionPlanRef = useRef<TransitionPlan | null>(null);
  const effectiveCrossfadeDurationSecRef = useRef<number | null>(null);
  const plannedAtMsRef = useRef<number | null>(null);
  const plannedReplanCountRef = useRef(0);
  const crossfadeStartTimeRef = useRef<number | null>(null);
  const trackEndedWhileCueingRef = useRef(false);
  const pendingCueTrackRef = useRef<{
    track: SoundCloudTrack;
    performance: DJPerformancePlan;
  } | null>(null);
  const performanceIntentRef = useRef<{ trackId: number; plan: DJPerformancePlan } | null>(null);
  const performanceLoopRepetitionsRef = useRef(0);

  const { play, pause, togglePlay, loadTrack, loadInitialTrack } = useDeckTransport({
    dispatch,
    actions,
    audio,
    djStateTypeRef,
    holdLoopCacheRef,
    energyHistoryRef,
    revibeTriggeredRef,
    ensureListeningSegment,
    finalizeCurrentListeningSegment,
    logEngine,
  });

  const resetTransitionRefs = useCallback(() => {
    transitionPlanRef.current = null;
    effectiveCrossfadeDurationSecRef.current = null;
    plannedAtMsRef.current = null;
    plannedReplanCountRef.current = 0;
    crossfadeStartTimeRef.current = null;
    revibeTriggeredRef.current = false;
    trackEndedWhileCueingRef.current = false;
    pendingTransitionMetricRef.current = null;
    performanceIntentRef.current = null;
    performanceLoopRepetitionsRef.current = 0;
  }, []);

  const cueNextTrack = useCallback(
    async (track: SoundCloudTrack, performancePlan: DJPerformancePlan) => {
      const currentState = djStateTypeRef.current;
      if (currentState === "crossfading") {
        pendingCueTrackRef.current = { track, performance: performancePlan };
        logEngine("engine.cue.deferred_crossfading", {
          trackId: track.id,
        });
        return;
      }
      const startedAt = performance.now();
      performanceIntentRef.current = { trackId: track.id, plan: performancePlan };
      performanceLoopRepetitionsRef.current = 0;

      const inactiveDeckId = getInactiveDeckId();
      const djTrack = await loadTrack(track, inactiveDeckId);
      if (!djTrack) return;
      await waitForDeckCanPlay(inactiveDeckId);

      const deck = getDeckElement(inactiveDeckId);
      const mediaDurationSec = getFiniteDurationSec(deck?.duration);
      const effectiveTrack = withEffectiveTrackDuration(djTrack, mediaDurationSec);
      if (
        mediaDurationSec !== null &&
        getFiniteDurationSec(djTrack.duration) !== null &&
        Math.abs((djTrack.duration as number) - mediaDurationSec) > 1
      ) {
        logEngine("engine.track.duration_mismatch", {
          deckId: inactiveDeckId,
          trackId: track.id,
          metadataDurationSec: Number((djTrack.duration as number).toFixed(3)),
          mediaDurationSec: Number(mediaDurationSec.toFixed(3)),
        });
      }
      const beatGrid = constructBeatGridFromBpm(djTrack.bpm);
      const deckSnapshot = createDeckSnapshot(
        inactiveDeckId,
        effectiveTrack,
        deck?.currentTime ?? 0,
        beatGrid,
        null,
      );

      const stateNow = djStateTypeRef.current;
      if (stateNow === "crossfading") {
        pendingCueTrackRef.current = { track, performance: performancePlan };
        logEngine("engine.cue.deferred_crossfading_after_load", {
          trackId: track.id,
        });
        return;
      }

      if (stateNow === "cueing" || stateNow === "planned") {
        dispatch({ type: "CANCEL_TRANSITION" });
      }

      dispatch({ type: "CUE_READY", deck: deckSnapshot });
      trackEndedWhileCueingRef.current = false;
      revibeTriggeredRef.current = true;
      logEngine("engine.cue.ready", {
        trackId: track.id,
        inactiveDeckId,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    },
    [getDeckElement, getInactiveDeckId, loadTrack, logEngine, waitForDeckCanPlay],
  );

  const planTransition = useCallback(() => {
    const state = engineState.djState;
    if (state.type !== "cueing") return;

    const activeDeckEl = getDeckElement(state.activeDeck.id);
    const cueDeckEl = getDeckElement(state.cueDeck.id);
    const currentTime = activeDeckEl?.currentTime ?? state.activeDeck.positionSec;
    const { plan, rawPlan, diagnostics } = resolveTransitionPlan({
      outgoingDeck: state.activeDeck,
      incomingDeck: state.cueDeck,
      analysis: state.analysis,
      currentTimeSec: currentTime,
      outgoingDurationSec: getFiniteDurationSec(activeDeckEl?.duration),
      incomingDurationSec: getFiniteDurationSec(cueDeckEl?.duration),
      performanceIntent: performanceIntentRef.current,
    });

    transitionPlanRef.current = plan;
    plannedAtMsRef.current = performance.now();
    plannedReplanCountRef.current = 0;
    logEngine("engine.transition.planned", {
      rawCrossfadeDurationSec: rawPlan.crossfadeDurationSec,
      crossfadeDurationSec: plan.crossfadeDurationSec,
      rawStartBoundarySec: rawPlan.startBoundary.timeSec,
      startBoundarySec: plan.startBoundary.timeSec,
      performanceSource: plan.performance?.source ?? "planner",
      performanceDiagnostics: diagnostics,
      performanceReason: plan.performance?.reason ?? null,
    });
    dispatch({ type: "PLAN_TRANSITION", plan });
  }, [engineState.djState, getDeckElement, logEngine]);

  const replanPlannedTransition = useCallback(() => {
    const state = engineState.djState;
    if (state.type !== "planned") return;
    const activeDeckEl = getDeckElement(state.activeDeck.id);
    const cueDeckEl = getDeckElement(state.cueDeck.id);
    const currentTime = activeDeckEl?.currentTime ?? state.activeDeck.positionSec;
    const { plan: nextPlan, rawPlan: rawNextPlan, diagnostics } = resolveTransitionPlan({
      outgoingDeck: state.activeDeck,
      incomingDeck: state.cueDeck,
      analysis: state.analysis,
      currentTimeSec: currentTime,
      outgoingDurationSec: getFiniteDurationSec(activeDeckEl?.duration),
      incomingDurationSec: getFiniteDurationSec(cueDeckEl?.duration),
      performanceIntent: performanceIntentRef.current,
    });
    transitionPlanRef.current = nextPlan;
    plannedAtMsRef.current = performance.now();
    plannedReplanCountRef.current += 1;
    diagnosticsRef.current.plannedTimeoutReplans += 1;
    logEngine("engine.transition.replanned", {
      replanCount: plannedReplanCountRef.current,
      rawCrossfadeDurationSec: rawNextPlan.crossfadeDurationSec,
      crossfadeDurationSec: nextPlan.crossfadeDurationSec,
      rawStartBoundarySec: rawNextPlan.startBoundary.timeSec,
      startBoundarySec: nextPlan.startBoundary.timeSec,
      performanceSource: nextPlan.performance?.source ?? "planner",
      performanceDiagnostics: diagnostics,
    });
    dispatch({ type: "PLAN_TRANSITION", plan: nextPlan });
  }, [engineState.djState, getDeckElement, logEngine]);

  const startCrossfade = useCallback(async () => {
    const state = engineState.djState;
    if (state.type !== "planned") return;
    if (crossfadeStartTimeRef.current !== null) return;

    const outgoingDeck = getDeckElement(state.activeDeck.id);
    const incomingDeck = getDeckElement(state.cueDeck.id);
    if (!outgoingDeck || !incomingDeck) return;
    if (!deckStatusRef.current[state.cueDeck.id].canPlay) return;

    const plannedCrossfadeDurationSec = state.plan.crossfadeDurationSec;
    const incomingDurationSec = incomingDeck.duration;
    const outgoingRemainingSec = Number.isFinite(outgoingDeck.duration)
      ? Math.max(0, outgoingDeck.duration - outgoingDeck.currentTime)
      : null;

    let effectiveCrossfadeDurationSec = plannedCrossfadeDurationSec;
    if (Number.isFinite(incomingDurationSec) && incomingDurationSec > 0) {
      effectiveCrossfadeDurationSec = Math.min(
        effectiveCrossfadeDurationSec,
        Math.max(0.1, incomingDurationSec - 0.1),
      );
    }
    if (typeof outgoingRemainingSec === "number") {
      if (outgoingRemainingSec <= 0.5) {
        effectiveCrossfadeDurationSec = Math.min(effectiveCrossfadeDurationSec, 0.5);
      } else {
        effectiveCrossfadeDurationSec = Math.min(
          effectiveCrossfadeDurationSec,
          Math.max(0.1, outgoingRemainingSec),
        );
      }
    }
    if (!Number.isFinite(effectiveCrossfadeDurationSec) || effectiveCrossfadeDurationSec <= 0) {
      effectiveCrossfadeDurationSec = Math.max(0.1, Math.min(32, plannedCrossfadeDurationSec));
    }
    effectiveCrossfadeDurationSecRef.current = effectiveCrossfadeDurationSec;

    crossfadeStartTimeRef.current = performance.now();
    plannedAtMsRef.current = null;

    const outgoingEQ = getActiveEQ();
    const incomingEQ = getInactiveEQ();
    const outgoingEnergy = getActiveAnalyzer()?.getEnergy("overall") ?? 0;
    const incomingEnergy = getInactiveAnalyzer()?.getEnergy("overall") ?? 0;
    const handoffEnergyMismatch = computeHandoffEnergyMismatch({
      outgoingEnergy,
      incomingEnergy,
    });
    pendingTransitionMetricRef.current = {
      handoffEnergyMismatch,
      isAbruptTransition: isAbruptTransition({
        mismatch: handoffEnergyMismatch,
        threshold: DEFAULT_ABRUPT_MISMATCH_THRESHOLD,
      }),
    };
    logEngine("engine.crossfade.starting", {
      outgoingDeck: state.activeDeck.id,
      incomingDeck: state.cueDeck.id,
      plannedCrossfadeDurationSec: Number(plannedCrossfadeDurationSec.toFixed(3)),
      effectiveCrossfadeDurationSec: Number(effectiveCrossfadeDurationSec.toFixed(3)),
      outgoingRemainingSec:
        typeof outgoingRemainingSec === "number" ? Number(outgoingRemainingSec.toFixed(3)) : null,
      incomingDurationSec: Number.isFinite(incomingDurationSec)
        ? Number(incomingDurationSec.toFixed(3))
        : null,
      handoffEnergyMismatch: Number(handoffEnergyMismatch.toFixed(4)),
      isAbruptTransition: pendingTransitionMetricRef.current.isAbruptTransition,
      crossfadeDurationSec: state.plan.crossfadeDurationSec,
      performance: state.plan.performance ?? null,
      plannedStartSec: state.plan.startBoundary.timeSec,
      actualOutgoingTimeSec: outgoingDeck.currentTime,
      timingDriftSec: outgoingDeck.currentTime - state.plan.startBoundary.timeSec,
    });

    if (outgoingEQ && incomingEQ) {
      outgoingEQ.setCurve(state.plan.eqCurve);
      incomingEQ.setCurve(state.plan.eqCurve);
    }

    if (state.plan.tempoAdjustment.feasible) {
      incomingDeck.playbackRate = state.plan.tempoAdjustment.targetPlaybackRate;
    } else {
      incomingDeck.playbackRate = 1;
    }
    logEngine("engine.crossfade.automation_configured", {
      crossfaderCurve: state.plan.performance?.crossfaderCurve ?? "linear",
      eqPreset: state.plan.performance?.eqPreset ?? "planner_curve",
      bassSwapAt: state.plan.performance?.bassSwapAt ?? null,
      incomingPlaybackRate: incomingDeck.playbackRate,
      durationSec: effectiveCrossfadeDurationSec,
    });

    try {
      const mixInSec =
        state.plan.performance?.incomingStartSec ?? state.cueDeck.cuePoints?.mixInSec ?? 0;
      const latestSafeEntry = Number.isFinite(incomingDeck.duration)
        ? Math.max(0, incomingDeck.duration - effectiveCrossfadeDurationSec - 1)
        : mixInSec;
      incomingDeck.currentTime = Math.min(mixInSec, latestSafeEntry);
      incomingDeck.volume = 0;
      outgoingDeck.volume = 1;
      await incomingDeck.play();
      crossfadeStartTimeRef.current = performance.now();
    } catch {
      crossfadeStartTimeRef.current = null;
      diagnosticsRef.current.transitionStartFailures += 1;
      diagnosticsRef.current.transitionAborts += 1;
      recordTransitionOutcome("failed_start");
      resetTransitionRefs();
      logEngine("engine.crossfade.start_failed", {
        incomingDeck: state.cueDeck.id,
      });
      dispatch({ type: "CANCEL_TRANSITION" });
      return;
    }

    dispatch({ type: "START_CROSSFADE" });
    logEngine("engine.crossfade.started", {
      incomingDeck: state.cueDeck.id,
      outgoingDeck: state.activeDeck.id,
    });
  }, [
    engineState.djState,
    getActiveAnalyzer,
    getActiveEQ,
    getDeckElement,
    getInactiveAnalyzer,
    getInactiveEQ,
    logEngine,
    recordTransitionOutcome,
    resetTransitionRefs,
  ]);

  const completeCrossfade = useCallback(() => {
    const state = engineState.djState;
    if (state.type !== "crossfading") return;

    const outgoingDeck = getDeckElement(state.outgoingDeck.id);
    const incomingDeck = getDeckElement(state.incomingDeck.id);

    if (outgoingDeck) {
      try {
        // Silence before transport mutation. pause()/seek can emit a final media frame.
        outgoingDeck.volume = 0;
        outgoingDeck.pause();
        outgoingDeck.currentTime = 0;
      } catch { }
      outgoingDeck.playbackRate = 1;
    }
    if (incomingDeck) {
      incomingDeck.playbackRate = 1;
      incomingDeck.volume = 1;
    }

    // Outgoing deck is muted, so resetting it is inaudible. Incoming EQ curve already
    // finishes at unity; resetting audible filters here can create a completion spike.
    getActiveEQ()?.reset();

    activeDeckRef.current = state.incomingDeck.id;
    bpmDetectorRef.current?.reset();
    energyHistoryRef.current = [];

    const storeState = useMusicPlayerStore.getState();
    const newActiveTrack =
      activeDeckRef.current === "A" ? storeState.trackA : storeState.trackB;
    if (newActiveTrack) {
      actions.setActiveTrack(newActiveTrack);
    }

    transitionPlanRef.current = null;
    effectiveCrossfadeDurationSecRef.current = null;
    plannedAtMsRef.current = null;
    plannedReplanCountRef.current = 0;
    crossfadeStartTimeRef.current = null;
    revibeTriggeredRef.current = false;
    trackEndedWhileCueingRef.current = false;
    performanceIntentRef.current = null;
    performanceLoopRepetitionsRef.current = 0;

    recordTransitionOutcome("completed");
    logEngine("engine.crossfade.completed", {
      incomingDeck: state.incomingDeck.id,
      outgoingDeck: state.outgoingDeck.id,
      outgoingMutedBeforePause: true,
      incomingEqReset: false,
    });
    dispatch({ type: "CROSSFADE_COMPLETE" });
    actions.resetTransition();
  }, [actions, engineState.djState, getActiveEQ, getDeckElement, getInactiveEQ, logEngine, recordTransitionOutcome]);

  useEffect(() => {
    if (engineState.djState.type !== "playing") return;
    if (!pendingCueTrackRef.current) return;
    const pending = pendingCueTrackRef.current;
    pendingCueTrackRef.current = null;
    runDetached(cueNextTrack(pending.track, pending.performance), (error) => {
      logEngine("engine.cue.deferred_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [cueNextTrack, engineState.djState.type, logEngine]);

  return {
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
  };
}
