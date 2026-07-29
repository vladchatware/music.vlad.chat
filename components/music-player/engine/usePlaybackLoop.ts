"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

import type FFTAnalyzer from "@/lib/analyzers/ftt";
import type { BPMDetector } from "@/lib/analyzers/bpm-detector";
import {
  getPlaybackBeatSnapshot,
  type AudioBeatSnapshot,
  type BeatAmplitudeRange,
  updateBeatAmplitude,
} from "@/lib/live/dancerMotion";
import {
  evaluatePerformanceLoop,
  getActiveDeck,
  isGoodTransitionMoment,
  type DJEvent,
  type DJState,
  type TransitionPlan,
} from "@/lib/dj";
import type { SuperpoweredAudioEngine } from "../audio-engine/superpoweredEngine";
import type { DeckPlaybackState } from "../audio-engine/types";
import type {
  MusicPlayerStore,
  TrackSection,
} from "../store/useMusicPlayerStore";
import {
  MIN_AUTO_CUE_PLAY_SEC,
  MIN_AUTO_CUE_PROGRESS,
  computeCrossfadeProgressByClock,
  evaluatePlannedTimeout,
  shouldEvaluatePlannedTimeout,
  shouldTriggerAutoCue,
  shouldTriggerAnalyzedAutoCue,
} from "./continuityMetrics";
import { sectionToAnalysis, type EngineDiagnostics } from "./runtimeModel";
import { runDetached } from "./asyncSafety";

type EngineLogger = (event: string, payload?: Record<string, unknown>) => void;

type PlaybackLoopOptions = {
  state: DJState;
  dispatch: (event: DJEvent) => void;
  actions: MusicPlayerStore["actions"];
  bpmDetectorRef: MutableRefObject<BPMDetector | null>;
  energyHistoryRef: MutableRefObject<number[]>;
  audioEnergyRef: MutableRefObject<number>;
  audioBeatRef: MutableRefObject<AudioBeatSnapshot>;
  revibeTriggeredRef: MutableRefObject<boolean>;
  transitionPlanRef: MutableRefObject<TransitionPlan | null>;
  effectiveCrossfadeDurationSecRef: MutableRefObject<number | null>;
  crossfadeStartTimeRef: MutableRefObject<number | null>;
  plannedAtMsRef: MutableRefObject<number | null>;
  plannedReplanCountRef: MutableRefObject<number>;
  performanceLoopRepetitionsRef: MutableRefObject<number>;
  diagnosticsRef: MutableRefObject<EngineDiagnostics>;
  engineRef: MutableRefObject<SuperpoweredAudioEngine>;
  getDeckState: (deck: "A" | "B") => DeckPlaybackState;
  getActiveDeckState: () => DeckPlaybackState;
  getActiveAnalyzer: () => FFTAnalyzer | null;
  getInactiveAnalyzer: () => FFTAnalyzer | null;
  onRequestNextTrack?: () => Promise<void>;
  autoCueConfig?: {
    minPlaySec?: number;
    minProgress?: number;
    minRemainingSec?: number;
    shortTrackMinHoldSec?: number;
    shortTrackMinProgress?: number;
    shortTrackMinRemainingSec?: number;
  };
  logEngine: EngineLogger;
  completeCrossfade: () => void;
  replanPlannedTransition: () => void;
  resetTransitionRefs: () => void;
  startCrossfade: () => Promise<void>;
  recordTransitionOutcome: (outcome: "completed" | "aborted" | "failed_start") => void;
};

export function usePlaybackLoop(options: PlaybackLoopOptions): void {
  const latestOptionsRef = useRef(options);
  const lastPublishAtRef = useRef(0);
  const beatAmplitudeRangeRef = useRef<BeatAmplitudeRange | null>(null);
  const heardTrackRef = useRef<{ trackId: number; startedAtMs: number } | null>(null);
  latestOptionsRef.current = options;

  useEffect(() => {
    let rafId: number | null = null;

    const loop = () => {
      const {
        state,
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
      } = latestOptionsRef.current;
      const detector = bpmDetectorRef.current;
      const isCrossfading = state.type === "crossfading";
      const analysisDeck = isCrossfading
        ? getDeckState(state.incomingDeck.id)
        : getActiveDeckState();
      const analysisAnalyzer = isCrossfading
        ? getInactiveAnalyzer()
        : getActiveAnalyzer();

      if (analysisDeck.loaded && analysisAnalyzer && detector && analysisDeck.playing) {
        const bassEnergy = analysisAnalyzer.getEnergy("bass");
        const overallEnergy = analysisAnalyzer.getEnergy("overall");
        audioEnergyRef.current = overallEnergy;
        const dropDetected = detector.detectBeat(bassEnergy);

        energyHistoryRef.current.push(overallEnergy);
        if (energyHistoryRef.current.length > 3000) energyHistoryRef.current.shift();

        const bpm = detector.hasReliableBPM() ? detector.getBPM() : null;
        const beatPhase = detector.getBeatPhase();
        const amplitude = updateBeatAmplitude(beatAmplitudeRangeRef.current, bassEnergy);
        beatAmplitudeRangeRef.current = amplitude.range;
        audioBeatRef.current = getPlaybackBeatSnapshot({
          beatGrid: getActiveDeck(state)?.beatGrid ?? null,
          currentTimeSec: analysisDeck.positionSec,
          strength: amplitude.strength,
          fallbackPhase: beatPhase,
          fallbackTracked: detector.getBeatInterval() > 0,
        });
        const timeToNextBeat = detector.getTimeToNextBeat();
        const stillDuration = detector.getCurrentStillDuration();
        let section: TrackSection = "unknown";
        if (stillDuration > 500) section = "breakdown";
        else if (overallEnergy > 0.6) section = "culmination";
        else if (overallEnergy > 0.3) section = "comeup";
        else section = "intro";

        const durationSec = analysisDeck.durationSec || 0;
        const progress01 =
          durationSec > 0
            ? Math.max(0, Math.min(1, analysisDeck.positionSec / durationSec))
            : 0;
        const nowMs = performance.now();
        if (nowMs - lastPublishAtRef.current >= 150) {
          lastPublishAtRef.current = nowMs;
          dispatch({
            type: "ANALYSIS_UPDATE",
            analysis: sectionToAnalysis(
              section,
              bpm,
              bassEnergy,
              overallEnergy,
              stillDuration,
              dropDetected,
              beatPhase,
              timeToNextBeat,
            ),
          });
          actions.setAnalysis({
            bpm,
            bpmSource: bpm ? "detector" : "fallback",
            barDurationSec: bpm ? (60 / bpm) * 4 : null,
            section,
            overallEnergy,
            bassEnergy,
            stillDurationMs: stillDuration,
            dropDetected,
          });
          actions.setPlayback({
            currentTimeSec: analysisDeck.positionSec,
            durationSec,
            progress01,
          });
        }

        if (state.type === "playing" && onRequestNextTrack && durationSec > 0) {
          const trackId = state.activeDeck.track.id;
          if (heardTrackRef.current?.trackId !== trackId) {
            heardTrackRef.current = { trackId, startedAtMs: performance.now() };
          }
          const listenedSec = Math.max(
            0,
            (performance.now() - heardTrackRef.current.startedAtMs) / 1000,
          );
          const remainingSec = Math.max(0, durationSec - analysisDeck.positionSec);
          const shouldCueByFallback = shouldTriggerAutoCue({
            currentTimeSec: analysisDeck.positionSec,
            listenedSec,
            durationSec,
            progress01,
            alreadyTriggered: revibeTriggeredRef.current,
            isPlayingState: true,
            section,
            minPlaySec: autoCueConfig?.minPlaySec ?? MIN_AUTO_CUE_PLAY_SEC,
            minProgress: autoCueConfig?.minProgress ?? MIN_AUTO_CUE_PROGRESS,
            minRemainingSec: autoCueConfig?.minRemainingSec,
            shortTrackMinHoldSec: autoCueConfig?.shortTrackMinHoldSec,
            shortTrackMinProgress: autoCueConfig?.shortTrackMinProgress,
            shortTrackMinRemainingSec: autoCueConfig?.shortTrackMinRemainingSec,
          });
          const analyzedMixOutSec = state.activeDeck.cuePoints?.mixOutSec;
          const shouldCueByAnalysis =
            typeof analyzedMixOutSec === "number" &&
            shouldTriggerAnalyzedAutoCue({
              currentTimeSec: analysisDeck.positionSec,
              mixOutSec: analyzedMixOutSec,
              listenedSec,
              alreadyTriggered: revibeTriggeredRef.current,
            });
          if (shouldCueByFallback || shouldCueByAnalysis) {
            revibeTriggeredRef.current = true;
            logEngine("engine.auto_cue.trigger", {
              currentTimeSec: Number(analysisDeck.positionSec.toFixed(2)),
              durationSec: Number(durationSec.toFixed(2)),
              remainingSec: Number(remainingSec.toFixed(2)),
              progress01: Number(progress01.toFixed(4)),
              listenedSec: Number(listenedSec.toFixed(2)),
              source: shouldCueByAnalysis ? "analysis" : "fallback",
            });
            void onRequestNextTrack().catch(() => {
              revibeTriggeredRef.current = false;
              logEngine("engine.auto_cue.trigger_failed");
            });
          }
        }
      }

      if (state.type === "crossfading") {
        const incomingDeck = getDeckState(state.incomingDeck.id);
        if (incomingDeck.loaded) {
          const performanceLoop = state.plan.performance?.loop;
          if (performanceLoop?.deck === "incoming") {
            const loopDecision = evaluatePerformanceLoop(
              performanceLoop,
              incomingDeck.positionSec,
              performanceLoopRepetitionsRef.current,
            );
            if (loopDecision.shouldSeek && loopDecision.seekToSec !== null) {
              engineRef.current.seek(state.incomingDeck.id, loopDecision.seekToSec);
              performanceLoopRepetitionsRef.current = loopDecision.completedRepetitions;
              logEngine("engine.performance.loop", {
                deck: "incoming",
                repetition: loopDecision.completedRepetitions,
                loop: performanceLoop,
              });
            }
          }
          const crossfadeDurationSec =
            effectiveCrossfadeDurationSecRef.current ?? state.plan.crossfadeDurationSec;
          const progress = computeCrossfadeProgressByClock({
            startedAtMs: crossfadeStartTimeRef.current,
            nowMs: performance.now(),
            durationSec: crossfadeDurationSec,
          });
          dispatch({ type: "CROSSFADE_TICK", progress });
          actions.setTransition({
            state: "crossfading",
            progress01: progress,
            durationSec: crossfadeDurationSec,
          });
          const transitionOverdue =
            crossfadeStartTimeRef.current !== null &&
            performance.now() - crossfadeStartTimeRef.current >
              (crossfadeDurationSec + 1) * 1000;
          if (transitionOverdue) {
            logEngine("engine.crossfade.completion_watchdog");
            completeCrossfade();
          }
        }
      }

      if (state.type === "planned" && transitionPlanRef.current) {
        const plan = transitionPlanRef.current;
        const activeDeck = getDeckState(state.activeDeck.id);
        const timeoutDecision =
          activeDeck.loaded &&
          shouldEvaluatePlannedTimeout({
            currentTimeSec: activeDeck.positionSec,
            plannedStartSec: plan.startBoundary.timeSec,
          })
            ? evaluatePlannedTimeout({
                plannedAtMs: plannedAtMsRef.current,
                nowMs: performance.now(),
                replanCount: plannedReplanCountRef.current,
              })
            : "none";
        if (timeoutDecision === "replan") {
          logEngine("engine.transition.timeout_replan");
          replanPlannedTransition();
          rafId = requestAnimationFrame(loop);
          return;
        }
        if (timeoutDecision === "abort") {
          diagnosticsRef.current.transitionAborts += 1;
          recordTransitionOutcome("aborted");
          resetTransitionRefs();
          logEngine("engine.transition.timeout_abort");
          dispatch({ type: "CANCEL_TRANSITION" });
          rafId = requestAnimationFrame(loop);
          return;
        }

        const performanceLoop = plan.performance?.loop;
        if (activeDeck.loaded && performanceLoop?.deck === "outgoing") {
          const loopDecision = evaluatePerformanceLoop(
            performanceLoop,
            activeDeck.positionSec,
            performanceLoopRepetitionsRef.current,
          );
          if (loopDecision.shouldSeek && loopDecision.seekToSec !== null) {
            engineRef.current.seek(state.activeDeck.id, loopDecision.seekToSec);
            performanceLoopRepetitionsRef.current = loopDecision.completedRepetitions;
            plannedAtMsRef.current = performance.now();
            logEngine("engine.performance.loop", {
              deck: "outgoing",
              repetition: loopDecision.completedRepetitions,
              loop: performanceLoop,
            });
            rafId = requestAnimationFrame(loop);
            return;
          }
          if (!loopDecision.done) {
            rafId = requestAnimationFrame(loop);
            return;
          }
        }

        const remainingSec =
          activeDeck.loaded && Number.isFinite(activeDeck.durationSec)
            ? Math.max(0, activeDeck.durationSec - activeDeck.positionSec)
            : null;
        const forceStart =
          Boolean(
            activeDeck.loaded &&
              Number.isFinite(activeDeck.durationSec) &&
              plan.startBoundary.timeSec >= activeDeck.durationSec - 0.25,
          ) &&
          typeof remainingSec === "number" &&
          remainingSec <= 8;
        if (activeDeck.loaded && isGoodTransitionMoment(activeDeck.positionSec, plan)) {
          runDetached(startCrossfade(), (error) => {
            logEngine("engine.crossfade.start_rejected", {
              message: error instanceof Error ? error.message : String(error),
            });
          });
        } else if (activeDeck.loaded && forceStart) {
          logEngine("engine.transition.force_start_short_remaining", {
            remainingSec: Number((remainingSec ?? 0).toFixed(3)),
            plannedStartSec: Number(plan.startBoundary.timeSec.toFixed(3)),
            trackDurationSec: Number(activeDeck.durationSec.toFixed(3)),
          });
          runDetached(startCrossfade(), (error) => {
            logEngine("engine.crossfade.start_rejected", {
              message: error instanceof Error ? error.message : String(error),
            });
          });
        } else if (activeDeck.loaded && (!activeDeck.playing || activeDeck.ended)) {
          runDetached(startCrossfade(), (error) => {
            logEngine("engine.crossfade.start_rejected", {
              message: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);
}
