"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

import type { BPMDetector } from "@/lib/analyzers/bpm-detector";
import type { DJState } from "@/lib/dj";
import type { SuperpoweredAudioEngine } from "../audio-engine/superpoweredEngine";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import {
  DEFAULT_HOLD_LOOP_WINDOW_SEC,
  computePhraseQuantizedHoldLoop,
  getEndedNextTrackAction,
} from "./continuityMetrics";
import type {
  DeckId,
  DeckStatus,
  EngineDiagnostics,
  HoldLoopCache,
} from "./runtimeModel";

type EngineLogger = (event: string, payload?: Record<string, unknown>) => void;

type DeckEventsOptions = {
  engineRef: MutableRefObject<SuperpoweredAudioEngine>;
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
  onTransitionComplete: () => void;
  onRequestNextTrack?: () => Promise<void>;
};

export function useDeckEvents(options: DeckEventsOptions): void {
  const {
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
    onTransitionComplete,
    onRequestNextTrack,
  } = options;
  const nextTrackRequestInFlightRef = useRef(false);

  useEffect(() => {
    const engine = engineRef.current;

    const holdLoopForContinuity = async (deckId: DeckId, reason: string) => {
      const state = engine.getDeckState(deckId);
      if (!state.loaded || state.durationSec <= 0) return false;

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
        Math.abs(cache.durationSec - state.durationSec) > 0.5 ||
        (cache.bpm === null && resolvedBpm !== null)
      ) {
        const planned = computePhraseQuantizedHoldLoop({
          durationSec: state.durationSec,
          bpm: resolvedBpm,
          fallbackWindowSec: DEFAULT_HOLD_LOOP_WINDOW_SEC,
        });
        cache = { durationSec: state.durationSec, ...planned };
        holdLoopCacheRef.current[deckId] = cache;
      }

      try {
        engine.loop(
          deckId,
          cache.loopStartSec,
          cache.loopStartSec + cache.windowSec,
        );
        engine.seek(deckId, cache.loopStartSec);
        await engine.play(deckId);
        ensureListeningSegment(performance.now());
        logEngine("engine.deck.hold_loop", {
          deckId,
          reason,
          loopStartSec: Number(cache.loopStartSec.toFixed(3)),
          windowSec: Number(cache.windowSec.toFixed(3)),
          bpm: cache.bpm,
          transport: "superpowered",
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

    const onEnded = async (deckId: DeckId) => {
      if (deckId !== activeDeckRef.current) return;
      const stateType = djStateTypeRef.current;
      if (stateType === "crossfading") return;

      finalizeCurrentListeningSegment(performance.now());
      if (stateType === "cueing") {
        trackEndedWhileCueingRef.current = true;
        await holdLoopForContinuity(deckId, "waiting_cue_ready");
        return;
      }
      if (stateType === "planned") {
        trackEndedWhileCueingRef.current = true;
        logEngine("engine.deck.ended_while_planned", { deckId });
        return;
      }

      if (onRequestNextTrack) {
        try {
          const endedAction = getEndedNextTrackAction({
            revibeTriggered: revibeTriggeredRef.current,
            requestInFlight: nextTrackRequestInFlightRef.current,
          });
          if (endedAction === "hold_pending") {
            await holdLoopForContinuity(deckId, "pending_next_track");
            return;
          }
          if (endedAction === "failed_attempt") {
            logEngine("engine.deck.ended_without_next_track", {
              deckId,
              reason: "dj_failed_to_choose",
            });
            return;
          }
          revibeTriggeredRef.current = true;
          nextTrackRequestInFlightRef.current = true;
          const holdLooped = await holdLoopForContinuity(deckId, "requesting_next_track");
          await onRequestNextTrack();
          if (!holdLooped && djStateTypeRef.current === "playing") {
            await holdLoopForContinuity(deckId, "requested_next_track");
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

    return engine.subscribe((event) => {
      if (event.type === "deck-loaded") {
        deckStatusRef.current[event.deck] = {
          canPlay: true,
          metadataLoaded: true,
          isPlaying: false,
          lastError: null,
        };
        logEngine("engine.deck.loadedmetadata", {
          deckId: event.deck,
          duration: event.state.durationSec,
          transport: "superpowered",
        });
      } else if (event.type === "deck-ended") {
        deckStatusRef.current[event.deck].isPlaying = false;
        void onEnded(event.deck);
      } else if (event.type === "deck-error") {
        deckStatusRef.current[event.deck] = {
          ...deckStatusRef.current[event.deck],
          canPlay: false,
          lastError: event.message,
        };
        logEngine("engine.deck.error", {
          deckId: event.deck,
          message: event.message,
          transport: "superpowered",
        });
      } else if (event.type === "transition-complete") {
        logEngine("engine.crossfade.worklet_complete", {
          outgoingDeck: event.outgoingDeck,
          incomingDeck: event.incomingDeck,
        });
        onTransitionComplete();
      }
    });
  }, [
    activeDeckRef,
    bpmDetectorRef,
    deckStatusRef,
    diagnosticsRef,
    djStateTypeRef,
    engineRef,
    ensureListeningSegment,
    finalizeCurrentListeningSegment,
    holdLoopCacheRef,
    logEngine,
    onRequestNextTrack,
    onTransitionComplete,
    revibeTriggeredRef,
    trackEndedWhileCueingRef,
  ]);
}
