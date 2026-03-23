"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useShallow } from "zustand/react/shallow";

import { api } from "@/convex/_generated/api";
import { fetchTrack, streamTrack } from "@/lib/soundcloud";
import { CoordinateMapper_Data } from "@/lib/mappers/coordinateMappers/data";

import { MusicPlayerScene } from "./Scene";
import { MusicPlayerOverlay } from "./Overlay";
import { useRevibeChat } from "./chat/useRevibeChat";
import { buildRevibePrompt } from "./chat/prompt";
import { type SoundCloudTrack } from "./types";
import { useDualDeckEngine } from "./engine/useDualDeckEngine";
import { useAudioAnalysis } from "./engine/useAudioAnalysis";
import { useMusicPlayerStore } from "./store/useMusicPlayerStore";

export default function MusicPlayer(props: { initialTrackId: string | number }) {
  const { initialTrackId } = props;

  const { transition, playback } = useMusicPlayerStore(
    useShallow((s) => ({
      transition: s.transition,
      playback: s.playback,
    })),
  );

  const user = useQuery(api.users.viewer);
  const isAuthenticated = useQuery(api.auth.isAuthenticated);
  const { signIn } = useAuthActions();

  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const iPadOS =
      navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1;
    const iOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return iPadOS || iOSDevice;
  }, []);

  const coordinateMapper = useMemo(() => new CoordinateMapper_Data(), []);

  const latestOnRevibeRef = useRef<
    ((e: Event | ThreeEvent<MouseEvent>) => Promise<void> | void) | null
  >(null);

  const engine = useDualDeckEngine({
    isIOS,
    onRevibeRef: latestOnRevibeRef as any,
  });

  const {
    deckARef,
    deckBRef,
    trackA,
    trackB,
    activeTrack,
    isPlaying,
    needsUserInteraction,
    togglePlay,
    playActiveDeck,
    pauseActiveDeck,
    loadInitialTrack,
    loadActiveDeckAndAutoplay,
    cueTrackOnInactiveDeck,
    crossfadeToCuedTrack,
    analyzerRef,
    bpmDetectorRef,
    audioEnergyRef,
    waitingForBeatRef,
    nextTrackReadyRef,
    crossfadeInProgressRef,
    trackEndedWhileCueingRef,
  } = engine;

  useAudioAnalysis({
    analyzerRef,
    bpmDetectorRef,
    coordinateMapper,
    audioEnergyRef,
    waitingForBeatRef,
    nextTrackReadyRef,
    crossfadeInProgressRef,
    trackEndedWhileCueingRef,
  });

  const onPlayerToolRequested = useCallback(
    async (id: number) => {
      const activeEl =
        (engine.activeDeckRef.current === "A" ? deckARef.current : deckBRef.current) ??
        null;
      const isActuallyPlaying = !!activeEl && !activeEl.paused && !!activeEl.src;

      const newTrack = (await fetchTrack(id)) as SoundCloudTrack;
      if (isActuallyPlaying) {
        await cueTrackOnInactiveDeck(newTrack);
      } else {
        await loadActiveDeckAndAutoplay(newTrack);
      }
    },
    [cueTrackOnInactiveDeck, deckARef, deckBRef, engine.activeDeckRef, isPlaying, loadActiveDeckAndAutoplay],
  );

  const { messages, sendMessage, status } = useRevibeChat({ onPlayerToolRequested });

  // Lock-screen / headset controls + metadata where supported.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ms = (navigator as any).mediaSession;
    if (!ms) return;

    try {
      if (activeTrack?.title) {
        ms.metadata = new (window as any).MediaMetadata({
          title: activeTrack?.title,
          artist: activeTrack?.user?.username || activeTrack?.user?.full_name || "",
          album: activeTrack?.genre || "",
          artwork: activeTrack?.artwork_url ? [{ src: activeTrack.artwork_url }] : undefined,
        });
      }
      ms.playbackState = isPlaying ? "playing" : "paused";
      ms.setActionHandler("play", () => {
        playActiveDeck().catch(() => {});
      });
      ms.setActionHandler("pause", () => {
        pauseActiveDeck();
      });
      ms.setActionHandler("stop", () => {
        pauseActiveDeck();
      });
      ms.setActionHandler("nexttrack", () => {
        try {
          latestOnRevibeRef.current?.(new Event("nexttrack") as any);
        } catch {}
      });
      ms.setActionHandler("previoustrack", () => {});
    } catch (e) {
      console.warn("MediaSession setup failed:", e);
    }
  }, [activeTrack, isPlaying, pauseActiveDeck, playActiveDeck]);

  const onFetchInitialTrack = useCallback(async () => {
    const track = (await fetchTrack(initialTrackId)) as SoundCloudTrack;
    await loadInitialTrack(track);
  }, [initialTrackId, loadInitialTrack]);

  useEffect(() => {
    if (isAuthenticated !== true) return;
    void onFetchInitialTrack();
  }, [isAuthenticated, onFetchInitialTrack]);

  const onRevibe = useCallback(
    async (e: Event | ThreeEvent<MouseEvent>) => {
      e.stopPropagation();

      if (isAuthenticated === false) {
        await signIn("anonymous");
        return;
      }

      if (status === "streaming") return;

      if (needsUserInteraction) {
        // If the user clicks Play before initial track is loaded, load + autoplay it.
        // (Previously togglePlay() would early-return because deck src was not set yet.)
        if (!trackA?.id) {
          const initialTrack = (await fetchTrack(initialTrackId)) as SoundCloudTrack;
          await loadActiveDeckAndAutoplay(initialTrack);
          return;
        }
        return togglePlay();
      }

      const currentTrack = activeTrack as SoundCloudTrack | null;

      let detectedBpm = currentTrack?.bpm ?? null;
      if (!detectedBpm && bpmDetectorRef.current?.hasReliableBPM()) {
        detectedBpm = bpmDetectorRef.current.getBPM();
      }

      const prompt = buildRevibePrompt({
        track: currentTrack,
        detectedBpm,
      });

      sendMessage({ role: "user", text: prompt });
    },
    [
      activeTrack,
      bpmDetectorRef,
      buildRevibePrompt,
      isAuthenticated,
      needsUserInteraction,
      sendMessage,
      signIn,
      status,
      togglePlay,
    ],
  );

  useEffect(() => {
    latestOnRevibeRef.current = onRevibe;
  }, [onRevibe]);

  const checkout = async () => {
    const res = await fetch(`/api/checkout_session`, {
      method: "POST",
      body: JSON.stringify({ price: 5 }),
    });
    const session = await res.json();
    window.open(session.url, "_blank");
  };

  return (
    <>
      <MusicPlayerScene
        initialTrackId={initialTrackId}
        coordinateMapper={coordinateMapper}
        audioEnergyRef={audioEnergyRef}
        isPlaybackActive={isPlaying}
        transitionHighlight={(() => {
          if (!transition || transition.state === "none") return null;
          if (transition.state === "planned") {
            // A small marker (not time-mapped; consistent visualization)
            return { start01: 0, end01: 0.01, intensity: 0.95 };
          }
          // Crossfade progress arc
          return { start01: 0, end01: Math.max(0, Math.min(1, transition.progress01)), intensity: 0.95 };
        })()}
      >
        <MusicPlayerOverlay
          isAuthenticated={isAuthenticated}
          activeTrack={activeTrack}
          messages={messages}
          onRevibe={onRevibe}
          status={status}
          buttonLabel={needsUserInteraction ? "Play" : "Revibe"}
          user={user}
          signIn={signIn}
          checkout={checkout}
        />
      </MusicPlayerScene>

      <audio
        ref={deckARef}
        src={streamTrack(trackA?.id) as any}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
      />
      <audio
        ref={deckBRef}
        src={streamTrack(trackB?.id) as any}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
      />
    </>
  );
}
