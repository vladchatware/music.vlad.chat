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
import { playbackDebug } from "@/lib/playbackDebug";
import { CoordinateMapper_Data } from "@/lib/mappers/coordinateMappers/data";

import { MusicPlayerScene } from "./Scene";
import { MusicPlayerOverlay } from "./Overlay";
import { useRevibeChat } from "./chat/useRevibeChat";
import { buildRevibePrompt } from "./chat/prompt";
import { type SoundCloudTrack } from "./types";
import { useDJEngine } from "./engine/useDJEngine";
import { useAudioAnalysis } from "./engine/useAudioAnalysis";
import { useMusicPlayerStore } from "./store/useMusicPlayerStore";

type MusicPlayerV2Props = {
  initialTrackId: string | number;
  playbackProfile?: "default" | "trackFocus";
};

export default function MusicPlayerV2(props: MusicPlayerV2Props) {
  const { initialTrackId, playbackProfile = "default" } = props;

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
  const initialLoadTrackKeyRef = useRef<string | null>(null);
  const autoNextFastRef = useRef<(() => Promise<boolean>) | null>(null);
  const queuedAutoRevibeRef = useRef(false);
  const autoNextFastInFlightRef = useRef(false);
  const autoNextFastLastAtMsRef = useRef(0);
  const autoCueConfig = useMemo(() => {
    if (playbackProfile !== "trackFocus") return undefined;
    // Track route: hold the current track's strongest section longer before queueing next.
    return {
      minPlaySec: 150,
      minProgress: 0.9,
      minRemainingSec: 2,
      shortTrackMinHoldSec: 26,
      shortTrackMinProgress: 0.86,
      shortTrackMinRemainingSec: 3,
    };
  }, [playbackProfile]);

  // Use the new DJ engine
  const engine = useDJEngine({
    isIOS,
    autoCueConfig,
    onRequestNextTrack: async () => {
      const startedAt = performance.now();
      playbackDebug("player.on_request_next_track");
      if (autoNextFastRef.current) {
        try {
          const usedFastPath = await autoNextFastRef.current();
          if (usedFastPath) {
            playbackDebug("player.on_request_next_track.completed", {
              mode: "fast_auto_next",
              elapsedMs: Math.round(performance.now() - startedAt),
            });
            return;
          }
        } catch (error) {
          playbackDebug("player.on_request_next_track.fast_path_failed", {
            elapsedMs: Math.round(performance.now() - startedAt),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (latestOnRevibeRef.current) {
        try {
          await latestOnRevibeRef.current(new Event("revibe"));
          playbackDebug("player.on_request_next_track.completed", {
            mode: "chat",
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        } catch (error) {
          playbackDebug("player.on_request_next_track.failed", {
            elapsedMs: Math.round(performance.now() - startedAt),
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
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
      queuedAutoRevibeRef.current = false;
      const startedAt = performance.now();
      playbackDebug("player.tool_request.begin", {
        trackId: id,
        state: djState.type,
      });
      const newTrack = (await fetchTrack(id)) as SoundCloudTrack;
      const shouldCue =
        djState.type === "playing" ||
        djState.type === "cueing" ||
        djState.type === "planned" ||
        djState.type === "crossfading";

      if (shouldCue) {
        await cueNextTrack(newTrack);
      } else {
        await loadInitialTrack(newTrack);
        await play();
      }
      playbackDebug("player.tool_request.done", {
        trackId: id,
        state: djState.type,
        mode: shouldCue ? "cue" : "initial_play",
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    },
    [cueNextTrack, djState.type, loadInitialTrack, play],
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

  const { messages, sendMessage, status } = useRevibeChat({
    onPlayerToolRequested,
    isTransitionBlocked: () =>
      djState.type === "cueing" ||
      djState.type === "planned" ||
      djState.type === "crossfading",
  });

  const requestAutoNextFast = useCallback(async (): Promise<boolean> => {
    const now = performance.now();
    if (autoNextFastInFlightRef.current) {
      playbackDebug("player.auto_next.fast.skip_inflight");
      return true;
    }
    if (now - autoNextFastLastAtMsRef.current < 1200) {
      playbackDebug("player.auto_next.fast.skip_recent");
      return true;
    }

    autoNextFastInFlightRef.current = true;
    autoNextFastLastAtMsRef.current = now;
    const startedAt = now;
    try {
      const exclude = [activeTrack?.id, trackA?.id, trackB?.id]
        .filter((id): id is number => Number.isFinite(id as number))
        .join(",");
      playbackDebug("player.auto_next.fast.begin", {
        exclude,
        djState: djState.type,
        chatStatus: status,
      });

      const res = await fetch(
        `/api/tracks/next${exclude.length > 0 ? `?exclude=${encodeURIComponent(exclude)}` : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        playbackDebug("player.auto_next.fast.http_error", {
          status: res.status,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
        return false;
      }

      const payload = (await res.json()) as { track?: SoundCloudTrack };
      const selected = payload.track;
      if (!selected || !selected.id) {
        playbackDebug("player.auto_next.fast.invalid_payload");
        return false;
      }

      const shouldCue =
        djState.type === "playing" ||
        djState.type === "cueing" ||
        djState.type === "planned" ||
        djState.type === "crossfading";
      if (shouldCue) {
        await cueNextTrack(selected);
      } else {
        await loadInitialTrack(selected);
        await play();
      }

      playbackDebug("player.auto_next.fast.done", {
        trackId: selected.id,
        mode: shouldCue ? "cue" : "initial_play",
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      return true;
    } catch (error) {
      playbackDebug("player.auto_next.fast.failed", {
        elapsedMs: Math.round(performance.now() - startedAt),
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      autoNextFastInFlightRef.current = false;
    }
  }, [activeTrack?.id, cueNextTrack, djState.type, loadInitialTrack, play, status, trackA?.id, trackB?.id]);

  useEffect(() => {
    autoNextFastRef.current = requestAutoNextFast;
  }, [requestAutoNextFast]);

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
    const startedAt = performance.now();
    const track = (await fetchTrack(initialTrackId)) as SoundCloudTrack;
    await loadInitialTrack(track);
    playbackDebug("player.initial_track_loaded", {
      trackId: track.id,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }, [initialTrackId, loadInitialTrack]);

  useEffect(() => {
    // Initial track loading should not depend on authenticated=true:
    // public/anonymous users can still play previews and should not get a blank route.
    if (isAuthenticated === undefined) return;
    const trackKey = String(initialTrackId);
    if (initialLoadTrackKeyRef.current === trackKey) return;
    initialLoadTrackKeyRef.current = trackKey;
    void onFetchInitialTrack();
  }, [initialTrackId, isAuthenticated, onFetchInitialTrack]);

  const onRevibe = useCallback(
    async (e: Event | ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const isAutoRequest =
        e.type === "revibe" || e.type === "nexttrack" || e.type === "auto-revibe";
      playbackDebug("player.revibe.requested", {
        eventType: e.type,
        isAutoRequest,
        status,
        djState: djState.type,
      });

      if (isAuthenticated === false) {
        if (!isAutoRequest) {
          await signIn("anonymous");
        }
        return;
      }

      if (status === "streaming") {
        if (isAutoRequest) {
          queuedAutoRevibeRef.current = true;
          playbackDebug("player.revibe.queued_while_streaming", {
            eventType: e.type,
          });
        }
        return;
      }

      if (needsUserInteraction) {
        if (isAutoRequest) return;
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

      let detectedBpm = currentTrack?.bpm ?? null;
      if (!detectedBpm && bpmDetectorRef.current?.hasReliableBPM()) {
        detectedBpm = bpmDetectorRef.current.getBPM();
      }

      const prompt = buildRevibePrompt({
        track: currentTrack,
        detectedBpm,
        continuityMode: isAutoRequest,
      });

      sendMessage({ role: "user", text: prompt });
      playbackDebug("player.revibe.prompt_sent", {
        eventType: e.type,
        activeTrackId: currentTrack?.id ?? null,
      });
    },
    [
      activeTrack,
      bpmDetectorRef,
      isAuthenticated,
      needsUserInteraction,
      sendMessage,
      signIn,
      status,
      djState.type,
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

  useEffect(() => {
    if (status === "streaming") return;
    if (!queuedAutoRevibeRef.current) return;
    if (djState.type !== "playing") {
      queuedAutoRevibeRef.current = false;
      return;
    }
    queuedAutoRevibeRef.current = false;
    playbackDebug("player.revibe.flush_queued_auto", {
      djState: djState.type,
      status,
    });
    void onRevibe(new Event("auto-revibe"));
  }, [djState.type, onRevibe, status]);

  useEffect(() => {
    playbackDebug("player.state", {
      djState: djState.type,
      chatStatus: status,
      phase,
      activeTrackId: activeTrack?.id ?? null,
      trackAId: trackA?.id ?? null,
      trackBId: trackB?.id ?? null,
    });
  }, [activeTrack?.id, djState.type, phase, status, trackA?.id, trackB?.id]);

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
        isPlaybackActive={isPlaying || isTransitioning}
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
