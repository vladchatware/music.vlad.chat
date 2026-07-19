"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useRevibeChat, type PlayerToolInput } from "./chat/useRevibeChat";
import { buildRevibePrompt } from "./chat/prompt";
import { type SoundCloudTrack } from "./types";
import { getPlayerEntryAction } from "./interactionPolicy";
import { useDJEngine } from "./engine/useDJEngine";
import { useAudioVisualization } from "./engine/useAudioVisualization";
import { runDetached } from "./engine/asyncSafety";
import { getSegmentRuntimeContext } from "./engine/runtimeModel";
import { useMusicPlayerStore } from "./store/useMusicPlayerStore";

type MusicPlayerProps = {
  initialTrackId: string | number;
  playbackProfile?: "default" | "trackFocus";
};

export default function MusicPlayer(props: MusicPlayerProps) {
  const { initialTrackId, playbackProfile = "default" } = props;
  const [likeOverrides, setLikeOverrides] = useState<Record<number, boolean>>({});
  const [likePendingTrackId, setLikePendingTrackId] = useState<number | null>(null);

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
      navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const iOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return iPadOS || iOSDevice;
  }, []);

  const coordinateMapper = useMemo(() => new CoordinateMapper_Data(), []);

  const latestOnRevibeRef = useRef<
    ((e: Event | ThreeEvent<MouseEvent>) => Promise<void> | void) | null
  >(null);
  const initialLoadTrackKeyRef = useRef<string | null>(null);
  const queuedAutoRevibeRef = useRef(false);
  const playedTrackIdsRef = useRef<number[]>([]);
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

  const requestNextTrack = useCallback(async () => {
    const startedAt = performance.now();
    playbackDebug("player.on_request_next_track");
    if (!latestOnRevibeRef.current) return;
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
  }, []);

  const engine = useDJEngine({
    isIOS,
    autoCueConfig,
    onRequestNextTrack: requestNextTrack,
  });

  const {
    deckARef,
    deckBRef,
    djState,
    phase,
    isPlaying,
    isTransitioning,
    activeDeck,
    analyzerRef,
    bpmDetectorRef,
    audioEnergyRef,
    togglePlay,
    play,
    pause,
    loadInitialTrack,
    cueNextTrack,
    clearPendingNextTrackRequest,
  } = engine;

  // Presentation state shared with scene and overlay.
  const { trackA, trackB, activeTrack, actions } = useMusicPlayerStore(
    useShallow((s) => ({
      trackA: s.trackA,
      trackB: s.trackB,
      activeTrack: s.activeTrack,
      actions: s.actions,
    })),
  );

  useAudioVisualization(analyzerRef, coordinateMapper);

  const needsUserInteraction = phase === "needsGesture";

  const onPlayerToolRequested = useCallback(
    async ({ id, performance: performancePlan }: PlayerToolInput) => {
      queuedAutoRevibeRef.current = false;
      if (playedTrackIdsRef.current.includes(id)) {
        playbackDebug("player.tool_request.repeated_track_rejected", {
          trackId: id,
          playedTrackIds: playedTrackIdsRef.current,
        });
        throw new Error(`Track ${id} already played in this session`);
      }
      const startedAt = performance.now();
      playbackDebug("player.tool_request.begin", {
        trackId: id,
        state: djState.type,
        performancePlan,
      });
      const newTrack = (await fetchTrack(id)) as SoundCloudTrack;
      const shouldCue =
        djState.type === "playing" ||
        djState.type === "cueing" ||
        djState.type === "planned" ||
        djState.type === "crossfading";

      if (shouldCue) {
        await cueNextTrack(newTrack, performancePlan);
      } else {
        await loadInitialTrack(newTrack);
        await play();
      }
      playbackDebug("player.tool_request.done", {
        trackId: id,
        state: djState.type,
        mode: shouldCue ? "cue" : "initial_play",
        elapsedMs: Math.round(performance.now() - startedAt),
        performanceReason: performancePlan.reason,
      });
    },
    [cueNextTrack, djState.type, loadInitialTrack, play],
  );

  const { setPalette } = actions;
  const activeTrackLiked = activeTrack
    ? likeOverrides[activeTrack.id] ?? Boolean(activeTrack.user_favorite)
    : false;

  useEffect(() => {
    const id = activeTrack?.id;
    if (!Number.isFinite(id)) return;
    const history = playedTrackIdsRef.current.filter((trackId) => trackId !== id);
    history.push(id as number);
    playedTrackIdsRef.current = history.slice(-32);
  }, [activeTrack?.id]);

  const getDJState = useCallback(() => ({
    state: djState.type,
    activeDeck: activeDeck
      ? {
          id: activeDeck.id,
          track: activeDeck.track,
          positionSec: playback.currentTimeSec,
          durationSec: playback.durationSec,
          cuePoints: activeDeck.cuePoints ?? null,
          hasBeatGrid: Boolean(activeDeck.beatGrid),
          hasStructure: Boolean(activeDeck.structureMap),
          hasEnergyCurve: Boolean(activeDeck.energyCurve),
          segmentContext: getSegmentRuntimeContext(
            activeDeck.segments ?? [],
            playback.currentTimeSec,
          ),
        }
      : null,
    cuedTrack:
      djState.type === "cueing" || djState.type === "planned"
        ? {
            track: djState.cueDeck.track,
            entrySegments: [...(djState.cueDeck.segments ?? [])]
              .sort((a, b) => (b.entryQuality ?? 0) - (a.entryQuality ?? 0))
              .slice(0, 4),
          }
        : djState.type === "crossfading"
          ? {
              track: djState.incomingDeck.track,
              entrySegments: [...(djState.incomingDeck.segments ?? [])]
                .sort((a, b) => (b.entryQuality ?? 0) - (a.entryQuality ?? 0))
                .slice(0, 4),
            }
          : null,
    plannedExit:
      djState.type === "planned"
        ? {
            atSec: djState.plan.startBoundary.timeSec,
            segment: djState.activeDeck.segments?.find((segment) =>
              djState.plan.startBoundary.timeSec >= segment.startSec &&
              djState.plan.startBoundary.timeSec < segment.endSec
            ) ?? null,
          }
        : null,
    liveAnalysis: analysis,
    transition,
    playedTrackIds: playedTrackIdsRef.current,
    capturedAtMs: Date.now(),
  }), [activeDeck, analysis, djState, playback.currentTimeSec, playback.durationSec, transition]);

  // Track color palette extraction
  useEffect(() => {
    if (!activeTrack?.artwork_url) return;

    // SoundCloud artwork URLs are often 100x100 (large.jpg)
    // We can swap it to t500x500 for better color extraction if needed
    const artworkUrl = activeTrack.artwork_url.replace("large.jpg", "t500x500.jpg");

    runDetached(import("@/lib/analyzers/colorPalette").then(({ extractPaletteFromUrl }) =>
      extractPaletteFromUrl(artworkUrl).then((colors) => {
        if (colors.length > 0) {
          setPalette(colors);
        }
      }),
    ), () => undefined);
  }, [activeTrack?.artwork_url, setPalette]);

  const { messages, sendMessage, status } = useRevibeChat({
    onPlayerToolRequested,
    getDJState,
    isTransitionBlocked: () =>
      djState.type === "cueing" ||
      djState.type === "planned" ||
      djState.type === "crossfading",
  });

  const previousChatStatusRef = useRef(status);
  useEffect(() => {
    const previousStatus = previousChatStatusRef.current;
    previousChatStatusRef.current = status;
    const requestSettled =
      (previousStatus === "submitted" || previousStatus === "streaming") &&
      (status === "ready" || status === "error");
    if (requestSettled && djState.type === "playing") {
      clearPendingNextTrackRequest("chat_settled_without_cue");
    }
  }, [clearPendingNextTrackRequest, djState.type, status]);

  // Lock-screen / headset controls + metadata where supported.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ms = navigator.mediaSession;
    if (!ms) return;

    try {
      if (activeTrack?.title) {
        ms.metadata = new MediaMetadata({
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
          latestOnRevibeRef.current?.(new Event("nexttrack"));
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
    runDetached(onFetchInitialTrack(), (error) => {
      initialLoadTrackKeyRef.current = null;
      playbackDebug("player.initial_track_failed", {
        trackId: initialTrackId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
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

      const entryAction = getPlayerEntryAction({
        isAutoRequest,
        isAuthenticated,
        needsUserInteraction,
        hasTrack: Boolean(trackA?.id),
      });
      switch (entryAction) {
        case "ignore":
          return;
        case "signInAndContinue":
          await signIn("anonymous");
          break;
        case "loadAndPlay": {
          const initialTrack = (await fetchTrack(initialTrackId)) as SoundCloudTrack;
          await loadInitialTrack(initialTrack);
          await play();
          return;
        }
        case "togglePlayback":
          return togglePlay();
        case "continue":
          break;
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
    runDetached(onRevibe(new Event("auto-revibe")), (error) => {
      playbackDebug("player.revibe.flush_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
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

  const openActiveTrackBackroom = useCallback(() => {
    if (!activeTrack) return;
    window.open(`/tracks/${activeTrack.id}/backroom`, "_blank", "noopener,noreferrer");
  }, [activeTrack]);

  const togglePlaybackFromShape = useCallback(() => {
    runDetached(togglePlay(), (error) => {
      playbackDebug("player.shape_playback_toggle_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [togglePlay]);

  const toggleActiveTrackLike = useCallback(async () => {
    if (!activeTrack || likePendingTrackId === activeTrack.id) return;
    if (!user?.soundcloudAccessToken) {
      const redirectTo = `${window.location.pathname}${window.location.search}`;
      await signIn("soundcloud", { redirectTo });
      return;
    }

    const trackId = activeTrack.id;
    const wasLiked = likeOverrides[trackId] ?? Boolean(activeTrack.user_favorite);
    const liked = !wasLiked;
    setLikePendingTrackId(trackId);
    setLikeOverrides((current) => ({ ...current, [trackId]: liked }));

    try {
      const response = await fetch(`/api/tracks/${trackId}/like`, {
        method: liked ? "POST" : "DELETE",
      });
      if (!response.ok) throw new Error(`Like request failed (${response.status})`);
      playbackDebug("player.shape_like_updated", { trackId, liked });
    } catch (error) {
      setLikeOverrides((current) => ({ ...current, [trackId]: wasLiked }));
      playbackDebug("player.shape_like_failed", {
        trackId,
        liked,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLikePendingTrackId((current) => current === trackId ? null : current);
    }
  }, [activeTrack, likeOverrides, likePendingTrackId, signIn, user?.soundcloudAccessToken]);

  return (
    <>
      <MusicPlayerScene
        initialTrackId={initialTrackId}
        coordinateMapper={coordinateMapper}
        audioEnergyRef={audioEnergyRef}
        isPlaybackActive={isPlaying || isTransitioning}
        transitionHighlight={transitionHighlight}
        onHashtagClick={activeTrack ? openActiveTrackBackroom : undefined}
        onPlayClick={activeTrack ? togglePlaybackFromShape : undefined}
        isPlaying={isPlaying}
        onLikeClick={
          activeTrack && likePendingTrackId !== activeTrack.id
            ? toggleActiveTrackLike
            : undefined
        }
        isLiked={activeTrackLiked}
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
