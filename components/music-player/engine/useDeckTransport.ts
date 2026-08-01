"use client";

import { useCallback, type MutableRefObject } from "react";

import {
  type DJEvent,
  type DJState,
  type DJTrack,
} from "@/lib/dj";
import { streamTrack } from "@/lib/soundcloud";
import type { SoundCloudTrack } from "../types";
import type { MusicPlayerStore } from "../store/useMusicPlayerStore";
import {
  buildInitialDeckSnapshot,
  soundCloudToDJTrack,
  type DeckId,
  type HoldLoopCache,
} from "./runtimeModel";
import type { DeckAudioGraph } from "./useDeckAudioGraph";

type EngineLogger = (event: string, payload?: Record<string, unknown>) => void;

type DeckTransportOptions = {
  dispatch: (event: DJEvent) => void;
  actions: MusicPlayerStore["actions"];
  audio: DeckAudioGraph;
  djStateTypeRef: MutableRefObject<DJState["type"]>;
  holdLoopCacheRef: MutableRefObject<Record<DeckId, HoldLoopCache | null>>;
  energyHistoryRef: MutableRefObject<number[]>;
  revibeTriggeredRef: MutableRefObject<boolean>;
  ensureListeningSegment: (atMs: number) => void;
  finalizeCurrentListeningSegment: (atMs: number) => void;
  logEngine: EngineLogger;
};

export function useDeckTransport(options: DeckTransportOptions) {
  const {
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
  } = options;
  const {
    activeDeckRef,
    bpmDetectorRef,
    deckStatusRef,
    engineRef,
    getActiveDeckState,
  } = audio;

  const play = useCallback(async () => {
    const deck = getActiveDeckState();
    if (!deck.loaded) return;
    await engineRef.current.play(activeDeckRef.current);
    ensureListeningSegment(performance.now());
    if (djStateTypeRef.current === "ready" || djStateTypeRef.current === "paused") {
      dispatch({ type: "PLAY" });
    }

    window.obsstudio?.startRecording();
  }, [ensureListeningSegment, getActiveDeckState]);

  const pause = useCallback(() => {
    engineRef.current.pause(activeDeckRef.current);
    if (
      djStateTypeRef.current === "playing" ||
      djStateTypeRef.current === "cueing" ||
      djStateTypeRef.current === "planned"
    ) {
      dispatch({ type: "PAUSE" });
    }
    finalizeCurrentListeningSegment(performance.now());

    window.obsstudio?.stopRecording();
  }, [finalizeCurrentListeningSegment]);

  const togglePlay = useCallback(async () => {
    const deck = getActiveDeckState();
    if (!deck.loaded) return;
    if (!deck.playing) {
      await play();
    } else {
      pause();
    }
  }, [getActiveDeckState, pause, play]);

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

      const url = streamTrack(track.id);
      if (!url) throw new Error(`Track ${track.id} has no stream URL`);
      try {
        const loaded = await engineRef.current.loadDeck(deckId, {
          id: track.id,
          url,
          bpm: track.bpm,
          durationSec:
            Number.isFinite(track.duration) && (track.duration ?? 0) > 0
              ? (track.duration as number) / 1000
              : null,
        });
        deckStatusRef.current[deckId] = {
          canPlay: true,
          metadataLoaded: true,
          isPlaying: false,
          lastError: null,
        };
        logEngine("engine.track.loaded", {
          deckId,
          trackId: track.id,
          durationSec: loaded.durationSec,
          transport: "superpowered",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deckStatusRef.current[deckId].lastError = message;
        logEngine("engine.track.load_failed", { deckId, trackId: track.id, message });
        throw error;
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
      const deckSnapshot = buildInitialDeckSnapshot(djTrack);

      dispatch({ type: "TRACK_LOADED", deck: deckSnapshot });
      actions.setActiveTrack(track);
      revibeTriggeredRef.current = false;
      logEngine("engine.initial_track.ready", {
        trackId: track.id,
        durationSec: djTrack.duration ?? null,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    },
    [actions, loadTrack, logEngine],
  );

  return { play, pause, togglePlay, loadTrack, loadInitialTrack };
}
