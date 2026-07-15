"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

import type { BPMDetector } from "@/lib/analyzers/bpm-detector";
import type { DJState } from "@/lib/dj";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import {
  DEFAULT_HOLD_LOOP_WINDOW_SEC,
  computePhraseQuantizedHoldLoop,
} from "./continuityMetrics";
import type {
  DeckId,
  DeckStatus,
  EngineDiagnostics,
  HoldLoopCache,
} from "./runtimeModel";

type EngineLogger = (event: string, payload?: Record<string, unknown>) => void;

type DeckEventsOptions = {
  deckARef: MutableRefObject<HTMLAudioElement | null>;
  deckBRef: MutableRefObject<HTMLAudioElement | null>;
  deckStatusRef: MutableRefObject<Record<DeckId, DeckStatus>>;
  activeDeckRef: MutableRefObject<DeckId>;
  bpmDetectorRef: MutableRefObject<BPMDetector | null>;
  holdLoopCacheRef: MutableRefObject<Record<DeckId, HoldLoopCache | null>>;
  djStateTypeRef: MutableRefObject<DJState["type"]>;
  trackEndedWhileCueingRef: MutableRefObject<boolean>;
  revibeTriggeredRef: MutableRefObject<boolean>;
  diagnosticsRef: MutableRefObject<EngineDiagnostics>;
  ensureListeningSegment: (atMs: number) => void;
  finalizeCurrentListeningSegment: (atMs: number) => void;
  logEngine: EngineLogger;
  onRequestNextTrack?: () => Promise<void>;
};

export function useDeckEvents(options: DeckEventsOptions): void {
  const {
    deckARef,
    deckBRef,
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
    onRequestNextTrack,
  } = options;
  const earlyEndRecoveryRef = useRef<Record<DeckId, number>>({ A: 0, B: 0 });
  const nextTrackRequestInFlightRef = useRef(false);

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
            ? (trackMeta?.bpm as number)
            : null;
        const detectorBpm =
          deckId === activeDeckRef.current && bpmDetectorRef.current?.hasReliableBPM()
            ? bpmDetectorRef.current.getBPM()
            : null;
        const resolvedBpm = detectorBpm ?? metadataBpm;

        let cache = holdLoopCacheRef.current[deckId];
        if (
          !cache ||
          Math.abs(cache.durationSec - durationSec) > 0.5 ||
          (cache.bpm === null && resolvedBpm !== null)
        ) {
          const planned = computePhraseQuantizedHoldLoop({
            durationSec,
            bpm: resolvedBpm,
            fallbackWindowSec: DEFAULT_HOLD_LOOP_WINDOW_SEC,
          });
          cache = { durationSec, ...planned };
          holdLoopCacheRef.current[deckId] = cache;
          logEngine("engine.deck.hold_loop_planned", {
            deckId,
            reason,
            bpmSource:
              detectorBpm !== null ? "detector" : metadataBpm !== null ? "metadata" : "fallback",
            bpm: cache.bpm,
            bars: cache.bars,
            barDurationSec:
              cache.barDurationSec !== null ? Number(cache.barDurationSec.toFixed(3)) : null,
            loopStartSec: Number(cache.loopStartSec.toFixed(3)),
            windowSec: Number(cache.windowSec.toFixed(3)),
            durationSec: Number(durationSec.toFixed(3)),
          });
        }

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
            ? (trackMeta?.duration as number) / 1000
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
        if (deckId === activeDeckRef.current) window.obsstudio?.startRecording();
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

        if (
          djStateTypeRef.current !== "crossfading" &&
          djStateTypeRef.current !== "cueing" &&
          djStateTypeRef.current !== "planned"
        ) {
          window.obsstudio?.stopRecording();
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
      cleanA();
      cleanB();
    };
  }, [
    activeDeckRef,
    bpmDetectorRef,
    deckARef,
    deckBRef,
    deckStatusRef,
    diagnosticsRef,
    djStateTypeRef,
    ensureListeningSegment,
    finalizeCurrentListeningSegment,
    holdLoopCacheRef,
    logEngine,
    onRequestNextTrack,
    revibeTriggeredRef,
    trackEndedWhileCueingRef,
  ]);
}
