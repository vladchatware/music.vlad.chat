"use client";

import { useCallback, useEffect, useMemo, useRef, useReducer } from "react";
import { useShallow } from "zustand/react/shallow";

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
  constructBeatGridFromBpm,
  EQController,
} from "@/lib/dj";

import FFTAnalyzer from "@/lib/analyzers/ftt";
import { BPMDetector } from "@/lib/analyzers/bpm-detector";
import { playbackDebug } from "@/lib/playbackDebug";
import { useMusicPlayerStore, type TrackSection } from "../store/useMusicPlayerStore";
import type { SoundCloudTrack } from "../types";
import {
  DEFAULT_HOLD_LOOP_WINDOW_SEC,
  DEFAULT_ABRUPT_MISMATCH_THRESHOLD,
  MIN_AUTO_CUE_PLAY_SEC,
  MIN_AUTO_CUE_PROGRESS,
  computePhraseQuantizedHoldLoop,
  computeCrossfadeProgressByClock,
  computeHandoffEnergyMismatch,
  evaluatePlannedTimeout,
  isAbruptTransition,
  shouldTriggerAutoCue,
} from "./continuityMetrics";

type TransitionOutcome = "completed" | "aborted" | "failed_start";

type DeckId = "A" | "B";
type DeckStatus = {
  canPlay: boolean;
  metadataLoaded: boolean;
  isPlaying: boolean;
  lastError: string | null;
};

type HoldLoopCache = {
  durationSec: number;
  loopStartSec: number;
  windowSec: number;
  barDurationSec: number | null;
  bars: number | null;
  bpm: number | null;
};

interface UseDJEngineOptions {
  isIOS: boolean;
  onRequestNextTrack?: () => Promise<void>;
  autoCueConfig?: {
    minPlaySec?: number;
    minProgress?: number;
    minRemainingSec?: number;
    shortTrackMinHoldSec?: number;
    shortTrackMinProgress?: number;
    shortTrackMinRemainingSec?: number;
  };
}

interface DJEngineState {
  djState: DJState;
  isIOS: boolean;
}

type TransitionMetric = {
  handoffEnergyMismatch: number;
  isAbruptTransition: boolean;
  transitionOutcome: TransitionOutcome;
  atMs: number;
};

type EngineDiagnostics = {
  transitionStartFailures: number;
  transitionAborts: number;
  plannedTimeoutReplans: number;
  earlyCutoffsCount: number;
  totalTransitions: number;
  abruptTransitions: number;
  transitionMetrics: TransitionMetric[];
  uninterruptedSegmentsSec: number[];
  currentSegmentStartMs: number | null;
};

function djEngineReducer(state: DJEngineState, action: DJEvent): DJEngineState {
  const result = djReducer(state.djState, action);
  return {
    ...state,
    djState: result.state,
  };
}

function soundCloudToDJTrack(track: SoundCloudTrack | null): DJTrack | null {
  if (!track) return null;
  const durationMs = (track as any)?.duration;
  return {
    id: track.id,
    title: track.title,
    artist: track.user?.username || track.user?.full_name,
    genre: track.genre,
    bpm: track.bpm,
    keySignature: track.key_signature,
    artworkUrl: track.artwork_url,
    duration:
      Number.isFinite(durationMs) && durationMs > 0
        ? durationMs / 1000
        : undefined,
  };
}

function createDeckSnapshot(
  id: DeckId,
  track: DJTrack,
  positionSec: number,
  beatGrid: BeatGrid | null,
  energyCurve: EnergyCurve | null,
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

function getFiniteDurationSec(value: number | null | undefined): number | null {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : null;
}

function withEffectiveTrackDuration(track: DJTrack, mediaDurationSec: number | null): DJTrack {
  if (mediaDurationSec === null) return track;
  const metadataDurationSec = getFiniteDurationSec(track.duration);
  if (metadataDurationSec !== null && Math.abs(metadataDurationSec - mediaDurationSec) < 1) {
    return track;
  }
  return {
    ...track,
    duration: mediaDurationSec,
  };
}

function clampTransitionPlanToMedia(opts: {
  plan: TransitionPlan;
  currentTimeSec: number;
  outgoingDurationSec: number | null;
  incomingDurationSec: number | null;
}): TransitionPlan {
  const { plan, currentTimeSec, outgoingDurationSec, incomingDurationSec } = opts;
  const maxByIncoming =
    incomingDurationSec !== null ? Math.max(1.5, incomingDurationSec - 1) : Number.POSITIVE_INFINITY;
  const maxByOutgoing =
    outgoingDurationSec !== null ? Math.max(1.5, outgoingDurationSec * 0.35) : Number.POSITIVE_INFINITY;
  const clampedCrossfadeDurationSec = Math.min(
    Math.max(1.5, plan.crossfadeDurationSec),
    8,
    maxByIncoming,
    maxByOutgoing,
  );

  const latestStartBoundarySec =
    outgoingDurationSec !== null ? Math.max(currentTimeSec, outgoingDurationSec - 0.25) : Number.POSITIVE_INFINITY;
  const clampedStartBoundarySec = Math.min(plan.startBoundary.timeSec, latestStartBoundarySec);

  if (
    clampedCrossfadeDurationSec === plan.crossfadeDurationSec &&
    clampedStartBoundarySec === plan.startBoundary.timeSec
  ) {
    return plan;
  }

  return {
    ...plan,
    crossfadeDurationSec: clampedCrossfadeDurationSec,
    startBoundary: {
      ...plan.startBoundary,
      timeSec: clampedStartBoundarySec,
    },
    eqCurve: {
      ...plan.eqCurve,
      durationSec: clampedCrossfadeDurationSec,
    },
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
  timeToNextBeatMs: number,
): AnalysisSnapshot {
  return {
    bpm,
    bpmSource: bpm ? "detected" : "fallback",
    section: section as any,
    overallEnergy,
    bassEnergy,
    stillDurationMs,
    dropDetected,
    beatPhase,
    timeToNextBeatMs,
  };
}

export function useDJEngine(opts: UseDJEngineOptions) {
  const { isIOS, onRequestNextTrack, autoCueConfig } = opts;

  const [engineState, dispatch] = useReducer(djEngineReducer, {
    djState: getInitialDJState(),
    isIOS,
  });

  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const analyzerARef = useRef<FFTAnalyzer | null>(null);
  const analyzerBRef = useRef<FFTAnalyzer | null>(null);
  const analyzerRef = useRef<FFTAnalyzer | null>(null); // persistent mixed-bus analyzer
  const bpmDetectorRef = useRef<BPMDetector | null>(null);

  const eqControllerARef = useRef<EQController | null>(null);
  const eqControllerBRef = useRef<EQController | null>(null);
  const masterMixRef = useRef<GainNode | null>(null);

  const activeDeckRef = useRef<DeckId>("A");
  const transitionPlanRef = useRef<TransitionPlan | null>(null);
  const effectiveCrossfadeDurationSecRef = useRef<number | null>(null);
  const plannedAtMsRef = useRef<number | null>(null);
  const plannedReplanCountRef = useRef(0);
  const crossfadeStartTimeRef = useRef<number | null>(null);
  const trackEndedWhileCueingRef = useRef(false);
  const pendingCueTrackRef = useRef<SoundCloudTrack | null>(null);
  const pendingTransitionMetricRef = useRef<{
    handoffEnergyMismatch: number;
    isAbruptTransition: boolean;
  } | null>(null);

  const revibeTriggeredRef = useRef(false);
  const earlyEndRecoveryRef = useRef<{ A: number; B: number }>({ A: 0, B: 0 });

  const deckStatusRef = useRef<Record<DeckId, DeckStatus>>({
    A: { canPlay: false, metadataLoaded: false, isPlaying: false, lastError: null },
    B: { canPlay: false, metadataLoaded: false, isPlaying: false, lastError: null },
  });
  const nextTrackRequestInFlightRef = useRef(false);
  const holdLoopCacheRef = useRef<Record<DeckId, HoldLoopCache | null>>({
    A: null,
    B: null,
  });

  const energyHistoryRef = useRef<number[]>([]);
  const diagnosticsRef = useRef<EngineDiagnostics>({
    transitionStartFailures: 0,
    transitionAborts: 0,
    plannedTimeoutReplans: 0,
    earlyCutoffsCount: 0,
    totalTransitions: 0,
    abruptTransitions: 0,
    transitionMetrics: [],
    uninterruptedSegmentsSec: [],
    currentSegmentStartMs: null,
  });
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

  const finalizeCurrentListeningSegment = useCallback((atMs: number) => {
    const startedAt = diagnosticsRef.current.currentSegmentStartMs;
    if (startedAt === null) return;
    const durationSec = Math.max(0, (atMs - startedAt) / 1000);
    diagnosticsRef.current.uninterruptedSegmentsSec.push(durationSec);
    diagnosticsRef.current.currentSegmentStartMs = null;
  }, []);

  const ensureListeningSegment = useCallback((atMs: number) => {
    if (diagnosticsRef.current.currentSegmentStartMs !== null) return;
    diagnosticsRef.current.currentSegmentStartMs = atMs;
  }, []);

  const recordTransitionOutcome = useCallback((outcome: TransitionOutcome) => {
    const pending = pendingTransitionMetricRef.current;
    if (!pending) return;
    const metric: TransitionMetric = {
      handoffEnergyMismatch: pending.handoffEnergyMismatch,
      isAbruptTransition: pending.isAbruptTransition,
      transitionOutcome: outcome,
      atMs: performance.now(),
    };
    diagnosticsRef.current.transitionMetrics.push(metric);
    if (diagnosticsRef.current.transitionMetrics.length > 200) {
      diagnosticsRef.current.transitionMetrics.shift();
    }
    diagnosticsRef.current.totalTransitions += 1;
    if (metric.isAbruptTransition) diagnosticsRef.current.abruptTransitions += 1;
    pendingTransitionMetricRef.current = null;
  }, []);

  useEffect(() => {
    actions.acquire();
    return () => {
      actions.release();
    };
  }, [actions]);

  const getDeckElement = useCallback((deckId: DeckId): HTMLAudioElement | null => {
    return deckId === "A" ? deckARef.current : deckBRef.current;
  }, []);

  const getInactiveDeckId = useCallback((): DeckId => {
    return activeDeckRef.current === "A" ? "B" : "A";
  }, []);

  const getActiveDeckElement = useCallback((): HTMLAudioElement | null => {
    return getDeckElement(activeDeckRef.current);
  }, [getDeckElement]);

  const getActiveAnalyzer = useCallback((): FFTAnalyzer | null => {
    return activeDeckRef.current === "A" ? analyzerARef.current : analyzerBRef.current;
  }, []);

  const getInactiveAnalyzer = useCallback((): FFTAnalyzer | null => {
    return activeDeckRef.current === "A" ? analyzerBRef.current : analyzerARef.current;
  }, []);

  const getActiveEQ = useCallback((): EQController | null => {
    return activeDeckRef.current === "A" ? eqControllerARef.current : eqControllerBRef.current;
  }, []);

  const getInactiveEQ = useCallback((): EQController | null => {
    return activeDeckRef.current === "A" ? eqControllerBRef.current : eqControllerARef.current;
  }, []);

  const waitForDeckCanPlay = useCallback(
    async (deckId: DeckId, timeoutMs = 20000) => {
      const deck = getDeckElement(deckId);
      if (!deck) throw new Error(`Deck ${deckId} is unavailable`);

      if (
        deckStatusRef.current[deckId].canPlay ||
        (deck.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && !!deck.src)
      ) {
        deckStatusRef.current[deckId].canPlay = true;
        logEngine("engine.deck.canplay.immediate", {
          deckId,
          readyState: deck.readyState,
          src: deck.currentSrc || deck.src,
        });
        return;
      }

      await new Promise<void>((resolve, reject) => {
        let done = false;
        const onCanPlay = () => {
          if (done) return;
          done = true;
          cleanup();
          deckStatusRef.current[deckId].canPlay = true;
          logEngine("engine.deck.canplay", {
            deckId,
            readyState: deck.readyState,
            src: deck.currentSrc || deck.src,
          });
          resolve();
        };
        const onError = () => {
          if (done) return;
          done = true;
          cleanup();
          const message = `Deck ${deckId} failed to load`;
          deckStatusRef.current[deckId].lastError = message;
          logEngine("engine.deck.canplay.error", {
            deckId,
            message,
            src: deck.currentSrc || deck.src,
          });
          reject(new Error(message));
        };
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          cleanup();
          logEngine("engine.deck.canplay.timeout", {
            deckId,
            timeoutMs,
            src: deck.currentSrc || deck.src,
          });
          reject(new Error(`Timed out waiting for deck ${deckId} canplay`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          deck.removeEventListener("canplay", onCanPlay);
          deck.removeEventListener("error", onError);
        };

        deck.addEventListener("canplay", onCanPlay);
        deck.addEventListener("error", onError);
      });
    },
    [getDeckElement, logEngine],
  );

  useEffect(() => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA || !deckB) return;

    deckA.crossOrigin = "anonymous";
    deckB.crossOrigin = "anonymous";

    if (!isIOS) {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextCtor();
      audioContextRef.current = ctx;

      const sourceA = ctx.createMediaElementSource(deckA);
      const sourceB = ctx.createMediaElementSource(deckB);

      const eqA = new EQController(ctx);
      const eqB = new EQController(ctx);
      const masterMix = ctx.createGain();
      masterMix.gain.value = 1;

      eqA.connectSource(sourceA);
      eqB.connectSource(sourceB);
      eqA.connectDestination(masterMix);
      eqB.connectDestination(masterMix);
      masterMix.connect(ctx.destination);

      eqControllerARef.current = eqA;
      eqControllerBRef.current = eqB;
      masterMixRef.current = masterMix;

      analyzerARef.current = new FFTAnalyzer(sourceA, ctx, 0);
      analyzerBRef.current = new FFTAnalyzer(sourceB, ctx, 0);
      analyzerRef.current = new FFTAnalyzer(masterMix, ctx, 0);

      deckA.volume = 1;
      deckB.volume = 1;
    } else {
      analyzerARef.current = null;
      analyzerBRef.current = null;
      analyzerRef.current = null;
      eqControllerARef.current = null;
      eqControllerBRef.current = null;
      masterMixRef.current = null;

      deckA.volume = 1;
      deckB.volume = 0;
    }

    bpmDetectorRef.current = new BPMDetector();

    return () => {
      analyzerARef.current?.toggleAnalyzer(false);
      analyzerBRef.current?.toggleAnalyzer(false);
      analyzerRef.current?.toggleAnalyzer(false);
      analyzerARef.current?.disconnectInputs();
      analyzerBRef.current?.disconnectInputs();
      analyzerRef.current?.disconnectInputs();

      eqControllerARef.current?.dispose();
      eqControllerBRef.current?.dispose();
      masterMixRef.current?.disconnect();
      audioContextRef.current?.close();

      try {
        deckA.pause();
        deckB.pause();
      } catch { }

      analyzerARef.current = null;
      analyzerBRef.current = null;
      analyzerRef.current = null;
      eqControllerARef.current = null;
      eqControllerBRef.current = null;
      masterMixRef.current = null;
      bpmDetectorRef.current = null;
      audioContextRef.current = null;
    };
  }, [isIOS]);

  useEffect(() => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA || !deckB) return;

    const updateStatus = (deckId: DeckId, patch: Partial<DeckStatus>) => {
      deckStatusRef.current[deckId] = {
        ...deckStatusRef.current[deckId],
        ...patch,
      };
    };

    const attach = (deckId: DeckId, deck: HTMLAudioElement) => {
      const holdLoopForContinuity = async (reason: string) => {
        const durationSec =
          Number.isFinite(deck.duration) && deck.duration > 0 ? deck.duration : null;
        if (durationSec === null) return false;

        const storeState = useMusicPlayerStore.getState();
        const trackMeta = deckId === "A" ? storeState.trackA : storeState.trackB;
        const metadataBpm =
          Number.isFinite(trackMeta?.bpm) && (trackMeta?.bpm as number) > 0
            ? (trackMeta!.bpm as number)
            : null;
        const detectorBpm =
          deckId === activeDeckRef.current && bpmDetectorRef.current?.hasReliableBPM()
            ? bpmDetectorRef.current.getBPM()
            : null;
        const resolvedBpm = detectorBpm ?? metadataBpm;

        let cache = holdLoopCacheRef.current[deckId];
        const shouldRecompute =
          !cache ||
          Math.abs(cache.durationSec - durationSec) > 0.5 ||
          (cache.bpm === null && resolvedBpm !== null);
        if (shouldRecompute) {
          const planned = computePhraseQuantizedHoldLoop({
            durationSec,
            bpm: resolvedBpm,
            fallbackWindowSec: DEFAULT_HOLD_LOOP_WINDOW_SEC,
          });
          cache = {
            durationSec,
            loopStartSec: planned.loopStartSec,
            windowSec: planned.windowSec,
            barDurationSec: planned.barDurationSec,
            bars: planned.bars,
            bpm: planned.bpm,
          };
          holdLoopCacheRef.current[deckId] = cache;
          logEngine("engine.deck.hold_loop_planned", {
            deckId,
            reason,
            bpmSource: detectorBpm !== null ? "detector" : metadataBpm !== null ? "metadata" : "fallback",
            bpm: cache.bpm,
            bars: cache.bars,
            barDurationSec:
              cache.barDurationSec !== null ? Number(cache.barDurationSec.toFixed(3)) : null,
            loopStartSec: Number(cache.loopStartSec.toFixed(3)),
            windowSec: Number(cache.windowSec.toFixed(3)),
            durationSec: Number(durationSec.toFixed(3)),
          });
        }
        if (!cache) return false;

        try {
          deck.currentTime = cache.loopStartSec;
          await deck.play();
          ensureListeningSegment(performance.now());
          logEngine("engine.deck.hold_loop", {
            deckId,
            reason,
            loopStartSec: Number(cache.loopStartSec.toFixed(3)),
            windowSec: Number(cache.windowSec.toFixed(3)),
            bars: cache.bars,
            barDurationSec:
              cache.barDurationSec !== null ? Number(cache.barDurationSec.toFixed(3)) : null,
            bpm: cache.bpm,
            durationSec: Number(durationSec.toFixed(3)),
          });
          return true;
        } catch (error) {
          logEngine("engine.deck.hold_loop_failed", {
            deckId,
            reason,
            message: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
      };

      const onLoadedMetadata = () => {
        updateStatus(deckId, { metadataLoaded: true });
        const storeState = useMusicPlayerStore.getState();
        const trackMeta = deckId === "A" ? storeState.trackA : storeState.trackB;
        const trackMetaDurationSec =
          Number.isFinite(trackMeta?.duration) && (trackMeta?.duration ?? 0) > 0
            ? (trackMeta!.duration as number) / 1000
            : null;
        logEngine("engine.deck.loadedmetadata", {
          deckId,
          currentTime: deck.currentTime,
          duration: deck.duration,
          trackMetaDurationSec,
          trackId: trackMeta?.id ?? null,
          readyState: deck.readyState,
          src: deck.currentSrc || deck.src,
        });
        if (
          trackMetaDurationSec !== null &&
          Number.isFinite(deck.duration) &&
          deck.duration > 0 &&
          trackMetaDurationSec >= 60 &&
          deck.duration <= 35
        ) {
          logEngine("engine.stream.preview_suspected", {
            deckId,
            trackId: trackMeta?.id ?? null,
            trackMetaDurationSec: Number(trackMetaDurationSec.toFixed(3)),
            deckDurationSec: Number(deck.duration.toFixed(3)),
          });
        }
      };
      const onCanPlay = () => {
        updateStatus(deckId, { canPlay: true, lastError: null });
        logEngine("engine.deck.canplay.event", {
          deckId,
          currentTime: deck.currentTime,
          duration: deck.duration,
          readyState: deck.readyState,
        });
      };
      const onPlaying = () => {
        updateStatus(deckId, { isPlaying: true, canPlay: true, lastError: null });
        earlyEndRecoveryRef.current[deckId] = 0;
        ensureListeningSegment(performance.now());
        logEngine("engine.deck.playing", {
          deckId,
          currentTime: deck.currentTime,
          duration: deck.duration,
          playbackRate: deck.playbackRate,
          volume: deck.volume,
        });
      };
      const onStalled = () => {
        updateStatus(deckId, { isPlaying: false });
        logEngine("engine.deck.stalled", {
          deckId,
          currentTime: deck.currentTime,
          readyState: deck.readyState,
          networkState: deck.networkState,
        });
      };
      const onWaiting = () => {
        updateStatus(deckId, { isPlaying: false });
        logEngine("engine.deck.waiting", {
          deckId,
          currentTime: deck.currentTime,
          readyState: deck.readyState,
          networkState: deck.networkState,
        });
      };
      const onPause = () => {
        updateStatus(deckId, { isPlaying: false });
        logEngine("engine.deck.pause", {
          deckId,
          currentTime: deck.currentTime,
          ended: deck.ended,
        });
      };
      const onError = () => {
        updateStatus(deckId, { canPlay: false, lastError: `Deck ${deckId} error` });
        logEngine("engine.deck.error", {
          deckId,
          currentTime: deck.currentTime,
          readyState: deck.readyState,
          networkState: deck.networkState,
          mediaError: deck.error?.message ?? deck.error?.code ?? null,
        });
      };

      const onEnded = async () => {
        if (deckId !== activeDeckRef.current) return;
        const stateType = djStateTypeRef.current;
        if (stateType === "crossfading") return;

        const duration = deck.duration;
        const endedTooEarly =
          Number.isFinite(duration) && duration > 0 && deck.currentTime < duration - 8;
        if (endedTooEarly && earlyEndRecoveryRef.current[deckId] < 1) {
          earlyEndRecoveryRef.current[deckId] += 1;
          try {
            deck.currentTime = Math.max(0, deck.currentTime - 0.75);
            await deck.play();
            return;
          } catch {
            diagnosticsRef.current.earlyCutoffsCount += 1;
            finalizeCurrentListeningSegment(performance.now());
            logEngine("engine.deck.ended_early_recovery_failed", {
              deckId,
              currentTime: deck.currentTime,
              duration,
            });
          }
        }

        if (stateType === "cueing") {
          trackEndedWhileCueingRef.current = true;
          await holdLoopForContinuity("waiting_cue_ready");
          return;
        }

        if (stateType === "planned") {
          trackEndedWhileCueingRef.current = true;
          logEngine("engine.deck.ended_while_planned", {
            deckId,
            currentTime: deck.currentTime,
            duration,
          });
          return;
        }

        if (onRequestNextTrack) {
          try {
            if (revibeTriggeredRef.current || nextTrackRequestInFlightRef.current) {
              await holdLoopForContinuity("pending_next_track");
              return;
            }

            revibeTriggeredRef.current = true;
            nextTrackRequestInFlightRef.current = true;
            logEngine("engine.deck.ended_requesting_next", {
              deckId,
              currentTime: deck.currentTime,
              duration,
            });
            const holdLooped = await holdLoopForContinuity("requesting_next_track");
            await onRequestNextTrack();
            if (!holdLooped && djStateTypeRef.current === "playing") {
              await holdLoopForContinuity("requested_next_track");
            }
          } catch {
            revibeTriggeredRef.current = false;
            diagnosticsRef.current.transitionAborts += 1;
            logEngine("engine.deck.ended_requesting_next_failed", { deckId });
          } finally {
            nextTrackRequestInFlightRef.current = false;
          }
        }
      };

      deck.addEventListener("loadedmetadata", onLoadedMetadata);
      deck.addEventListener("canplay", onCanPlay);
      deck.addEventListener("playing", onPlaying);
      deck.addEventListener("stalled", onStalled);
      deck.addEventListener("waiting", onWaiting);
      deck.addEventListener("pause", onPause);
      deck.addEventListener("error", onError);
      deck.addEventListener("ended", onEnded);

      return () => {
        deck.removeEventListener("loadedmetadata", onLoadedMetadata);
        deck.removeEventListener("canplay", onCanPlay);
        deck.removeEventListener("playing", onPlaying);
        deck.removeEventListener("stalled", onStalled);
        deck.removeEventListener("waiting", onWaiting);
        deck.removeEventListener("pause", onPause);
        deck.removeEventListener("error", onError);
        deck.removeEventListener("ended", onEnded);
      };
    };

    const cleanA = attach("A", deckA);
    const cleanB = attach("B", deckB);
    return () => {
      cleanA?.();
      cleanB?.();
    };
  }, [ensureListeningSegment, finalizeCurrentListeningSegment, logEngine, onRequestNextTrack]);

  const resetTransitionRefs = useCallback(() => {
    transitionPlanRef.current = null;
    effectiveCrossfadeDurationSecRef.current = null;
    plannedAtMsRef.current = null;
    plannedReplanCountRef.current = 0;
    crossfadeStartTimeRef.current = null;
    revibeTriggeredRef.current = false;
    trackEndedWhileCueingRef.current = false;
    pendingTransitionMetricRef.current = null;
  }, []);

  const play = useCallback(async () => {
    const deck = getActiveDeckElement();
    if (!deck || !deck.src) return;

    if (audioContextRef.current?.state === "suspended") {
      await audioContextRef.current.resume();
    }

    await deck.play();
    ensureListeningSegment(performance.now());
    if (djStateTypeRef.current === "ready" || djStateTypeRef.current === "paused") {
      dispatch({ type: "PLAY" });
    }
  }, [ensureListeningSegment, getActiveDeckElement]);

  const pause = useCallback(() => {
    const deck = getActiveDeckElement();
    if (!deck) return;
    deck.pause();
    if (
      djStateTypeRef.current === "playing" ||
      djStateTypeRef.current === "cueing" ||
      djStateTypeRef.current === "planned"
    ) {
      dispatch({ type: "PAUSE" });
    }
    finalizeCurrentListeningSegment(performance.now());
  }, [finalizeCurrentListeningSegment, getActiveDeckElement]);

  const togglePlay = useCallback(async () => {
    const deck = getActiveDeckElement();
    if (!deck || !deck.src) return;
    if (deck.paused) {
      await play();
    } else {
      pause();
    }
  }, [getActiveDeckElement, pause, play]);

  const loadTrack = useCallback(
    async (track: SoundCloudTrack, deckId: DeckId): Promise<DJTrack | null> => {
      const djTrack = soundCloudToDJTrack(track);
      if (!djTrack) return null;
      logEngine("engine.track.load", {
        deckId,
        trackId: track.id,
        title: track.title,
        trackDurationMs: track.duration ?? null,
      });

      dispatch({ type: "LOAD_TRACK", trackId: djTrack.id, deck: deckId });
      if (deckId === "A") actions.setTrackA(track);
      else actions.setTrackB(track);

      deckStatusRef.current[deckId] = {
        canPlay: false,
        metadataLoaded: false,
        isPlaying: false,
        lastError: null,
      };
      holdLoopCacheRef.current[deckId] = null;

      if (deckId === activeDeckRef.current) {
        energyHistoryRef.current = [];
        bpmDetectorRef.current?.reset();
      }

      return djTrack;
    },
    [actions, logEngine],
  );

  const loadInitialTrack = useCallback(
    async (track: SoundCloudTrack) => {
      const startedAt = performance.now();
      const djTrack = await loadTrack(track, "A");
      if (!djTrack) return;

      activeDeckRef.current = "A";
      await waitForDeckCanPlay("A");

      const deck = getDeckElement("A");
      const mediaDurationSec = getFiniteDurationSec(deck?.duration);
      const effectiveTrack = withEffectiveTrackDuration(djTrack, mediaDurationSec);
      if (
        mediaDurationSec !== null &&
        getFiniteDurationSec(djTrack.duration) !== null &&
        Math.abs((djTrack.duration as number) - mediaDurationSec) > 1
      ) {
        logEngine("engine.track.duration_mismatch", {
          deckId: "A",
          trackId: track.id,
          metadataDurationSec: Number((djTrack.duration as number).toFixed(3)),
          mediaDurationSec: Number(mediaDurationSec.toFixed(3)),
        });
      }
      const beatGrid = constructBeatGridFromBpm(djTrack.bpm);
      const deckSnapshot = createDeckSnapshot(
        "A",
        effectiveTrack,
        deck?.currentTime ?? 0,
        beatGrid,
        null,
      );

      dispatch({ type: "TRACK_LOADED", deck: deckSnapshot });
      actions.setActiveTrack(track);
      revibeTriggeredRef.current = false;
      logEngine("engine.initial_track.ready", {
        trackId: track.id,
        durationSec: deck?.duration ?? null,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    },
    [actions, getDeckElement, loadTrack, logEngine, waitForDeckCanPlay],
  );

  const cueNextTrack = useCallback(
    async (track: SoundCloudTrack) => {
      const currentState = djStateTypeRef.current;
      if (currentState === "crossfading") {
        pendingCueTrackRef.current = track;
        logEngine("engine.cue.deferred_crossfading", {
          trackId: track.id,
        });
        return;
      }
      const startedAt = performance.now();

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
        pendingCueTrackRef.current = track;
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
    const rawPlan = createTransitionPlan({
      outgoingDeck: state.activeDeck,
      incomingDeck: state.cueDeck,
      currentTimeSec: currentTime,
      analysis: state.analysis,
    });
    const plan = clampTransitionPlanToMedia({
      plan: rawPlan,
      currentTimeSec: currentTime,
      outgoingDurationSec: getFiniteDurationSec(activeDeckEl?.duration),
      incomingDurationSec: getFiniteDurationSec(cueDeckEl?.duration),
    });

    transitionPlanRef.current = plan;
    plannedAtMsRef.current = performance.now();
    plannedReplanCountRef.current = 0;
    logEngine("engine.transition.planned", {
      rawCrossfadeDurationSec: rawPlan.crossfadeDurationSec,
      crossfadeDurationSec: plan.crossfadeDurationSec,
      rawStartBoundarySec: rawPlan.startBoundary.timeSec,
      startBoundarySec: plan.startBoundary.timeSec,
    });
    dispatch({ type: "PLAN_TRANSITION", plan });
  }, [engineState.djState, getDeckElement, logEngine]);

  const replanPlannedTransition = useCallback(() => {
    const state = engineState.djState;
    if (state.type !== "planned") return;
    const activeDeckEl = getDeckElement(state.activeDeck.id);
    const cueDeckEl = getDeckElement(state.cueDeck.id);
    const currentTime = activeDeckEl?.currentTime ?? state.activeDeck.positionSec;
    const rawNextPlan = createTransitionPlan({
      outgoingDeck: state.activeDeck,
      incomingDeck: state.cueDeck,
      currentTimeSec: currentTime,
      analysis: state.analysis,
    });
    const nextPlan = clampTransitionPlanToMedia({
      plan: rawNextPlan,
      currentTimeSec: currentTime,
      outgoingDurationSec: getFiniteDurationSec(activeDeckEl?.duration),
      incomingDurationSec: getFiniteDurationSec(cueDeckEl?.duration),
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
    });
    dispatch({ type: "PLAN_TRANSITION", plan: nextPlan });
  }, [engineState.djState, getDeckElement, logEngine]);

  const cancelTransition = useCallback((reason = "manual") => {
    diagnosticsRef.current.transitionAborts += 1;
    logEngine("engine.transition.cancel", { reason });
    recordTransitionOutcome("aborted");
    resetTransitionRefs();

    const inactiveDeck = getDeckElement(getInactiveDeckId());
    if (inactiveDeck) {
      try {
        inactiveDeck.pause();
        inactiveDeck.currentTime = 0;
      } catch { }
      inactiveDeck.playbackRate = 1;
    }

    getActiveEQ()?.reset();
    getInactiveEQ()?.reset();
    dispatch({ type: "CANCEL_TRANSITION" });
  }, [
    getActiveEQ,
    getDeckElement,
    getInactiveDeckId,
    getInactiveEQ,
    logEngine,
    recordTransitionOutcome,
    resetTransitionRefs,
  ]);

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
        Math.max(1.5, incomingDurationSec - 1),
      );
    }
    if (typeof outgoingRemainingSec === "number") {
      if (outgoingRemainingSec <= 0.5) {
        effectiveCrossfadeDurationSec = Math.min(effectiveCrossfadeDurationSec, 1.5);
      } else {
        effectiveCrossfadeDurationSec = Math.min(
          effectiveCrossfadeDurationSec,
          Math.max(1.5, outgoingRemainingSec),
        );
      }
    }
    if (!Number.isFinite(effectiveCrossfadeDurationSec) || effectiveCrossfadeDurationSec <= 0) {
      effectiveCrossfadeDurationSec = Math.max(1.5, Math.min(8, plannedCrossfadeDurationSec));
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

    try {
      incomingDeck.currentTime = 0;
      if (!outgoingEQ || !incomingEQ) {
        incomingDeck.volume = 0;
        outgoingDeck.volume = 1;
      }
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
        outgoingDeck.pause();
        outgoingDeck.currentTime = 0;
      } catch { }
      outgoingDeck.playbackRate = 1;
      outgoingDeck.volume = 0;
    }
    if (incomingDeck) {
      incomingDeck.playbackRate = 1;
      incomingDeck.volume = 1;
    }

    getActiveEQ()?.reset();
    getInactiveEQ()?.reset();

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

    recordTransitionOutcome("completed");
    logEngine("engine.crossfade.completed", {
      incomingDeck: state.incomingDeck.id,
      outgoingDeck: state.outgoingDeck.id,
    });
    dispatch({ type: "CROSSFADE_COMPLETE" });
    actions.resetTransition();
  }, [actions, engineState.djState, getActiveEQ, getDeckElement, getInactiveEQ, logEngine, recordTransitionOutcome]);

  useEffect(() => {
    if (engineState.djState.type !== "playing") return;
    if (!pendingCueTrackRef.current) return;
    const pending = pendingCueTrackRef.current;
    pendingCueTrackRef.current = null;
    void cueNextTrack(pending);
  }, [cueNextTrack, engineState.djState.type]);

  useEffect(() => {
    let rafId: number | null = null;

    const loop = () => {
      const detector = bpmDetectorRef.current;
      const state = engineState.djState;

      const isCrossfading = state.type === "crossfading";
      const analysisDeck = isCrossfading
        ? getDeckElement(state.incomingDeck.id)
        : getActiveDeckElement();
      const analysisAnalyzer = isCrossfading
        ? getInactiveAnalyzer()
        : getActiveAnalyzer();

      if (analysisDeck && analysisAnalyzer && detector && !analysisDeck.paused) {
        const bassEnergy = analysisAnalyzer.getEnergy("bass");
        const overallEnergy = analysisAnalyzer.getEnergy("overall");
        const dropDetected = detector.detectBeat(bassEnergy);

        energyHistoryRef.current.push(overallEnergy);
        if (energyHistoryRef.current.length > 3000) {
          energyHistoryRef.current.shift();
        }

        const bpm = detector.hasReliableBPM() ? detector.getBPM() : null;
        const beatPhase = detector.getBeatPhase();
        const timeToNextBeat = detector.getTimeToNextBeat();
        const stillDuration = detector.getCurrentStillDuration();

        let section: TrackSection = "unknown";
        if (stillDuration > 500) section = "breakdown";
        else if (overallEnergy > 0.6) section = "culmination";
        else if (overallEnergy > 0.3) section = "comeup";
        else section = "intro";

        const analysis = sectionToAnalysis(
          section,
          bpm,
          bassEnergy,
          overallEnergy,
          stillDuration,
          dropDetected,
          beatPhase,
          timeToNextBeat,
        );

        dispatch({ type: "ANALYSIS_UPDATE", analysis });
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

        const durationSec = analysisDeck.duration || 0;
        const progress01 =
          durationSec > 0 ? Math.max(0, Math.min(1, analysisDeck.currentTime / durationSec)) : 0;
        actions.setPlayback({
          currentTimeSec: analysisDeck.currentTime,
          durationSec,
          progress01,
        });

        if (state.type === "playing" && onRequestNextTrack && durationSec > 0) {
          const remainingSec = Math.max(0, durationSec - analysisDeck.currentTime);
          const shouldCue = shouldTriggerAutoCue({
            currentTimeSec: analysisDeck.currentTime,
            durationSec,
            progress01,
            alreadyTriggered: revibeTriggeredRef.current,
            isPlayingState: true,
            minPlaySec: autoCueConfig?.minPlaySec ?? MIN_AUTO_CUE_PLAY_SEC,
            minProgress: autoCueConfig?.minProgress ?? MIN_AUTO_CUE_PROGRESS,
            minRemainingSec: autoCueConfig?.minRemainingSec,
            shortTrackMinHoldSec: autoCueConfig?.shortTrackMinHoldSec,
            shortTrackMinProgress: autoCueConfig?.shortTrackMinProgress,
            shortTrackMinRemainingSec: autoCueConfig?.shortTrackMinRemainingSec,
          });
          if (shouldCue) {
            revibeTriggeredRef.current = true;
            logEngine("engine.auto_cue.trigger", {
              currentTimeSec: Number(analysisDeck.currentTime.toFixed(2)),
              durationSec: Number(durationSec.toFixed(2)),
              remainingSec: Number(remainingSec.toFixed(2)),
              progress01: Number(progress01.toFixed(4)),
            });
            void onRequestNextTrack().catch(() => {
              revibeTriggeredRef.current = false;
              logEngine("engine.auto_cue.trigger_failed");
            });
          }
        }
      }

      if (state.type === "crossfading") {
        const outgoingDeck = getDeckElement(state.outgoingDeck.id);
        const incomingDeck = getDeckElement(state.incomingDeck.id);
        if (incomingDeck) {
          const crossfadeDurationSec =
            effectiveCrossfadeDurationSecRef.current ?? state.plan.crossfadeDurationSec;
          const progress = computeCrossfadeProgressByClock({
            startedAtMs: crossfadeStartTimeRef.current,
            nowMs: performance.now(),
            durationSec: crossfadeDurationSec,
          });

          const outgoingEQ = getActiveEQ();
          const incomingEQ = getInactiveEQ();
          if (outgoingEQ && incomingEQ) {
            outgoingEQ.tick(progress, true);
            incomingEQ.tick(progress, false);
          } else if (outgoingDeck && incomingDeck) {
            outgoingDeck.volume = Math.max(0, 1 - progress);
            incomingDeck.volume = Math.max(0, Math.min(1, progress));
          }

          dispatch({ type: "CROSSFADE_TICK", progress });
          actions.setTransition({
            state: "crossfading",
            progress01: progress,
            durationSec: crossfadeDurationSec,
          });

          if (progress >= 1) {
            completeCrossfade();
          }
        }
      }

      if (state.type === "planned" && transitionPlanRef.current) {
        const timeoutDecision = evaluatePlannedTimeout({
          plannedAtMs: plannedAtMsRef.current,
          nowMs: performance.now(),
          replanCount: plannedReplanCountRef.current,
        });
        if (timeoutDecision === "replan") {
          logEngine("engine.transition.timeout_replan");
          replanPlannedTransition();
          rafId = requestAnimationFrame(loop);
          return;
        } else if (timeoutDecision === "abort") {
          diagnosticsRef.current.transitionAborts += 1;
          recordTransitionOutcome("aborted");
          resetTransitionRefs();
          logEngine("engine.transition.timeout_abort");
          dispatch({ type: "CANCEL_TRANSITION" });
          rafId = requestAnimationFrame(loop);
          return;
        }

        const activeDeck = getDeckElement(state.activeDeck.id);
        const activeRemainingSec =
          activeDeck && Number.isFinite(activeDeck.duration)
            ? Math.max(0, activeDeck.duration - activeDeck.currentTime)
            : null;
        const hasUnreachableBoundary =
          activeDeck &&
          Number.isFinite(activeDeck.duration) &&
          transitionPlanRef.current.startBoundary.timeSec >= (activeDeck.duration - 0.25);
        const forceStartForShortRemaining =
          Boolean(hasUnreachableBoundary) &&
          typeof activeRemainingSec === "number" &&
          activeRemainingSec <= 8;
        if (activeDeck && isGoodTransitionMoment(activeDeck.currentTime, transitionPlanRef.current)) {
          void startCrossfade();
        } else if (activeDeck && forceStartForShortRemaining) {
          logEngine("engine.transition.force_start_short_remaining", {
            remainingSec: Number((activeRemainingSec ?? 0).toFixed(3)),
            plannedStartSec: Number(transitionPlanRef.current.startBoundary.timeSec.toFixed(3)),
            trackDurationSec: Number((activeDeck.duration ?? 0).toFixed(3)),
          });
          void startCrossfade();
        } else if (activeDeck && (activeDeck.paused || activeDeck.ended)) {
          void startCrossfade();
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    actions,
    completeCrossfade,
    engineState.djState,
    getActiveAnalyzer,
    getActiveDeckElement,
    getActiveEQ,
    getDeckElement,
    getInactiveAnalyzer,
    getInactiveEQ,
    onRequestNextTrack,
    logEngine,
    recordTransitionOutcome,
    replanPlannedTransition,
    resetTransitionRefs,
    startCrossfade,
  ]);

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
      void startCrossfade();
    }
  }, [engineState.djState.type, startCrossfade]);

  useEffect(() => {
    const stateType = engineState.djState.type;
    if (stateType === "planned") {
      const plan = (engineState.djState as any).plan;
      actions.setTransition({
        state: "planned",
        progress01: 0,
        durationSec: plan.crossfadeDurationSec,
        plannedStartSec: plan.startBoundary.timeSec,
      });
    } else if (
      stateType === "playing" ||
      stateType === "idle" ||
      stateType === "paused" ||
      stateType === "ready"
    ) {
      actions.resetTransition();
    }
  }, [actions, engineState.djState]);

  const isPlaying = isTrackPlaying(engineState.djState);
  const isTransitioning = isTransitionActive(engineState.djState);
  const activeDeck = getActiveDeck(engineState.djState);

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

  const engineDiagnostics = useMemo(() => {
    const d = diagnosticsRef.current;
    const currentSegmentSec =
      d.currentSegmentStartMs === null ? 0 : Math.max(0, (performance.now() - d.currentSegmentStartMs) / 1000);
    const abruptTransitionRate =
      d.totalTransitions > 0 ? d.abruptTransitions / d.totalTransitions : 0;
    return {
      transitionStartFailures: d.transitionStartFailures,
      transitionAborts: d.transitionAborts,
      plannedTimeoutReplans: d.plannedTimeoutReplans,
      earlyCutoffsCount: d.earlyCutoffsCount,
      totalTransitions: d.totalTransitions,
      abruptTransitions: d.abruptTransitions,
      abruptTransitionRate,
      transitionMetrics: [...d.transitionMetrics],
      uninterruptedSegmentsSec: [...d.uninterruptedSegmentsSec],
      currentSegmentSec,
    };
  }, [engineState.djState]);

  return {
    deckARef,
    deckBRef,
    djState: engineState.djState,
    phase,
    isPlaying,
    isTransitioning,
    activeDeck,
    transitionPlan: transitionPlanRef.current,
    trackEndedWhileCueing: trackEndedWhileCueingRef.current,
    engineDiagnostics,

    analyzerRef,
    bpmDetectorRef,

    play,
    pause,
    togglePlay,
    loadInitialTrack,
    cueNextTrack,
    planTransition,
    startCrossfade,
    cancelTransition,
    dispatch,
  };
}
