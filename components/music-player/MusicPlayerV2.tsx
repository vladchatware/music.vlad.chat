"use client";

/**
 * MusicPlayer V2
 * 
 * A redesigned music player using the new DJ architecture.
 * This component uses the useDJEngine hook which provides:
 * - Deterministic state machine for playback control
 * - Professional DJ transition features (beatmatching, phrase matching, EQ)
 * - Harmonic compatibility checking
 * - Energy-based transition scoring
 */

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
import { useDJEngine } from "./engine/useDJEngine";
import { useAudioAnalysis } from "./engine/useAudioAnalysis";
import { useMusicPlayerStore } from "./store/useMusicPlayerStore";

export default function MusicPlayerV2(props: { initialTrackId: string | number }) {
  const { initialTrackId } = props;

  const { transition, playback, analysis } = useMusicPlayerStore(
    useShallow((s) => ({
      transition: s.transition,
      playback: s.playback,
      analysis: s.analysis,
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

  const [isPortrait, setIsPortrait] = React.useState(false);
  useEffect(() => {
    const handleResize = () => setIsPortrait(window.innerHeight > window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const coordinateMapper = useMemo(() => new CoordinateMapper_Data(), []);

  const latestOnRevibeRef = useRef<
    ((e: Event | ThreeEvent<MouseEvent>) => Promise<void> | void) | null
  >(null);

  // Use the new DJ engine
  const engine = useDJEngine({
    isIOS,
    onRequestNextTrack: async () => {
      if (latestOnRevibeRef.current) {
        await latestOnRevibeRef.current(new Event("revibe"));
      }
    },
  });

  const {
    deckARef,
    deckBRef,
    djState,
    phase,
    isPlaying,
    isTransitioning,
    activeDeck,
    transitionPlan,
    trackEndedWhileCueing,
    analyzerRef,
    bpmDetectorRef,
    togglePlay,
    play,
    pause,
    loadInitialTrack,
    cueNextTrack,
  } = engine;

  // Track state from legacy store for compatibility
  const { trackA, trackB, activeTrack, actions } = useMusicPlayerStore(
    useShallow((s) => ({
      trackA: s.trackA,
      trackB: s.trackB,
      activeTrack: s.activeTrack,
      actions: s.actions,
    })),
  );

  // Create refs for audio analysis compatibility
  const audioEnergyRef = useRef(0);
  const waitingForBeatRef = useRef(false);
  const nextTrackReadyRef = useRef(false);
  const crossfadeInProgressRef = useRef(false);
  const trackEndedWhileCueingRef = useRef(false);

  // Keep refs in sync with DJ state
  useEffect(() => {
    waitingForBeatRef.current = djState.type === 'cueing' || djState.type === 'planned';
    nextTrackReadyRef.current = djState.type === 'planned';
    crossfadeInProgressRef.current = djState.type === 'crossfading';
    trackEndedWhileCueingRef.current = trackEndedWhileCueing;
  }, [djState.type, trackEndedWhileCueing]);

  // Use existing audio analysis for visualization
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

  const needsUserInteraction = phase === "needsGesture";

  const onPlayerToolRequested = useCallback(
    async (id: number) => {
      const newTrack = (await fetchTrack(id)) as SoundCloudTrack;

      if (isPlaying) {
        await cueNextTrack(newTrack);
      } else {
        await loadInitialTrack(newTrack);
        await play();
      }
    },
    [cueNextTrack, isPlaying, loadInitialTrack, play],
  );

  const { setPalette } = actions;

  // Track color palette extraction
  useEffect(() => {
    if (!activeTrack?.artwork_url) return;

    // SoundCloud artwork URLs are often 100x100 (large.jpg)
    // We can swap it to t500x500 for better color extraction if needed
    const artworkUrl = activeTrack.artwork_url.replace("large.jpg", "t500x500.jpg");

    void import("@/lib/analyzers/colorPalette").then(({ extractPaletteFromUrl }) => {
      extractPaletteFromUrl(artworkUrl).then((colors) => {
        if (colors.length > 0) {
          setPalette(colors);
        }
      });
    });
  }, [activeTrack?.artwork_url, setPalette]);

  const onKnobsToolRequested = useCallback(
    async (knobs: any) => {
      actions.setKnobs(knobs);
    },
    [actions],
  );

  const { messages, sendMessage, status } = useRevibeChat({
    onPlayerToolRequested,
    onKnobsToolRequested
  });

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
        play().catch(() => { });
      });
      ms.setActionHandler("pause", () => {
        pause();
      });
      ms.setActionHandler("stop", () => {
        pause();
      });
      ms.setActionHandler("nexttrack", () => {
        try {
          latestOnRevibeRef.current?.(new Event("nexttrack") as any);
        } catch { }
      });
      ms.setActionHandler("previoustrack", () => { });
    } catch (e) {
      console.warn("MediaSession setup failed:", e);
    }
  }, [activeTrack, isPlaying, pause, play]);

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
        if (!trackA?.id) {
          const initialTrack = (await fetchTrack(initialTrackId)) as SoundCloudTrack;
          await loadInitialTrack(initialTrack);
          await play();
          return;
        }
        return togglePlay();
      }

      const currentTrack = activeTrack as SoundCloudTrack | null;

      const prompt = buildRevibePrompt({
        track: currentTrack,
        analysis,
        playback,
      });

      sendMessage({ role: "user", text: prompt });
    },
    [
      activeTrack,
      bpmDetectorRef,
      isAuthenticated,
      needsUserInteraction,
      sendMessage,
      signIn,
      status,
      togglePlay,
      trackA?.id,
      initialTrackId,
      loadInitialTrack,
      play,
    ],
  );

  useEffect(() => {
    latestOnRevibeRef.current = onRevibe;
  }, [onRevibe]);

  // Proactive sound adjustment on section change
  const lastSectionRef = useRef(analysis.section);
  const lastSectionChangeTriggerRef = useRef(0);
  useEffect(() => {
    if (!analysis.section || analysis.section === "unknown" || !isPlaying) return;

    if (analysis.section !== lastSectionRef.current) {
      const now = Date.now();
      // Cooldown of 60 seconds between proactive sound checks
      if (now - lastSectionChangeTriggerRef.current > 60000 && status === "ready") {
        lastSectionRef.current = analysis.section;
        lastSectionChangeTriggerRef.current = now;
        console.log(`Proactive Section Check: ${analysis.section}`);
        if (latestOnRevibeRef.current) {
          latestOnRevibeRef.current(new Event("section-change"));
        }
      }
    }
  }, [analysis.section, status, isPlaying]);

  const checkout = async () => {
    const res = await fetch(`/api/checkout_session`, {
      method: "POST",
      body: JSON.stringify({ price: 5 }),
    });
    const session = await res.json();
    window.open(session.url, "_blank");
  };

  // Calculate transition highlight for visualization
  const transitionHighlight = useMemo(() => {
    if (!transition || transition.state === "none") return null;
    if (transition.state === "planned") {
      return { start01: 0, end01: 0.01, intensity: 0.95 };
    }
    return {
      start01: 0,
      end01: Math.max(0, Math.min(1, transition.progress01)),
      intensity: 0.95
    };
  }, [transition]);

  return (
    <>
      <MusicPlayerScene
        initialTrackId={initialTrackId}
        coordinateMapper={coordinateMapper}
        audioEnergyRef={audioEnergyRef}
        transitionHighlight={transitionHighlight}
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
          isIOS={isIOS}
          isPortrait={isPortrait}
        />
      </MusicPlayerScene>

      <audio
        ref={deckARef}
        src={streamTrack(trackA?.id)}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
      />
      <audio
        ref={deckBRef}
        src={streamTrack(trackB?.id)}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
      />
    </>
  );
}
