"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useShallow } from "zustand/react/shallow";

import { api } from "@/convex/_generated/api";
import { fetchTrack } from "@/lib/soundcloud";
import { playbackDebug } from "@/lib/playbackDebug";
import { CoordinateMapper_Data } from "@/lib/mappers/coordinateMappers/data";
import {
  advanceAudibleDwell,
  type AudibleDwellState,
  isLastingBodyTrack,
  minimumDwellExitSec,
} from "@/lib/dj/lastingSet";

import { MusicPlayerScene } from "./Scene";
import { MusicPlayerOverlay } from "./Overlay";
import { useRevibeChat, type PlayerToolInput } from "./chat/useRevibeChat";
import {
  createContinuityIntentController,
  classifyAgentSessionTerminal,
  computePlaybackAgentSessionDeadlineAtMs,
} from "./chat/continuityIntent";
import { buildRevibePrompt, REVIBE_PROMPT } from "./chat/prompt";
import {
  appendConfirmedTransition,
  appendPlayedTrack,
  appendScheduledCandidates,
  createPerformanceMemory,
  type PerformanceMemoryTrack,
} from "./chat/performanceMemory";
import { FRUTIGER_AERO_OPENING_TRACK_IDS } from "@/lib/dj/performance/frutigerAeroPreparedSet";
import { type SoundCloudTrack } from "./types";
import { getPlayerEntryAction } from "./interactionPolicy";
import { useDJEngine } from "./engine/useDJEngine";
import { useAudioVisualization } from "./engine/useAudioVisualization";
import { runDetached } from "./engine/asyncSafety";
import { getSegmentRuntimeContext } from "./engine/runtimeModel";
import { useMusicPlayerStore } from "./store/useMusicPlayerStore";
import type { BroadcastSources } from "@/components/live/useLiveKitBroadcast";

type MusicPlayerProps = {
  initialTrackId: string | number;
  playbackProfile?: "default" | "trackFocus";
  liveSessionKey?: string;
  onBroadcastSourcesReady?: (sources: BroadcastSources) => void;
  broadcastPortrait?: boolean;
};

function compactPerformanceTrack(track: SoundCloudTrack): PerformanceMemoryTrack {
  return {
    id: track.id,
    title: track.title ?? "Untitled",
    artist: track.user?.username ?? track.user?.full_name ?? "Unknown artist",
  };
}


export default function MusicPlayer(props: MusicPlayerProps) {
  const {
    initialTrackId,
    playbackProfile = "default",
    liveSessionKey,
    onBroadcastSourcesReady,
    broadcastPortrait = false,
  } = props;
  const [broadcastCanvas, setBroadcastCanvas] = useState<HTMLCanvasElement | null>(null);
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
  const agentSessionDeadlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentSessionController = useMemo(
    () => createContinuityIntentController(),
    [],
  );
  const playedTrackIdsRef = useRef<number[]>([]);
  const activeTrackHeardRef = useRef<AudibleDwellState | null>(null);
  const performanceMemoryRef = useRef(createPerformanceMemory(
    REVIBE_PROMPT,
    FRUTIGER_AERO_OPENING_TRACK_IDS,
  ));
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
    djState,
    phase,
    isPlaying,
    isTransitioning,
    activeDeck,
    activePlaybackRate,
    analyzerRef,
    bpmDetectorRef,
    broadcastAudioStreamRef,
    audioEnergyRef,
    audioBeatRef,
    togglePlay,
    play,
    pause,
    loadInitialTrack,
    cueNextTrack,
  } = engine;

  useEffect(() => {
    if (!broadcastCanvas || !broadcastAudioStreamRef.current || !onBroadcastSourcesReady) return;
    onBroadcastSourcesReady({
      canvas: broadcastCanvas,
      audioStream: broadcastAudioStreamRef.current,
    });
  }, [broadcastAudioStreamRef, broadcastCanvas, onBroadcastSourcesReady]);

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

  const clearAgentSessionDeadline = useCallback(() => {
    if (!agentSessionDeadlineTimerRef.current) return;
    clearTimeout(agentSessionDeadlineTimerRef.current);
    agentSessionDeadlineTimerRef.current = null;
  }, []);

  const onPlayerToolRequested = useCallback(
    async ({ id, performance: performancePlan }: PlayerToolInput) => {
      const agentSession = agentSessionController.getActive();
      if (!agentSession) {
        playbackDebug("dj.agent_session.failed", {
          reason: "stale_session",
          stage: "player_action",
          trackId: id,
        });
        throw new Error("Player action rejected without active agent session");
      }
      const actionStart = agentSessionController.beginPlayerAction({
        sessionId: agentSession.id,
        activeTrackId: activeTrack?.id ?? -1,
      });
      if (actionStart.outcome === "failed") {
        playbackDebug("dj.agent_session.failed", {
          reason: actionStart.reason,
          stage: "player_action",
          agentSessionId: agentSession.id,
          trackId: id,
        });
        throw new Error(`Player action rejected: ${actionStart.reason}`);
      }
      try {
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
          agentSessionId: agentSession.id,
        });
        const newTrack = (await fetchTrack(id)) as SoundCloudTrack;
        if (agentSession.source !== "user" && !isLastingBodyTrack(newTrack.duration, "ms")) {
          throw new Error(`Track ${id} is too short for autonomous continuity`);
        }
        const deadlineCheck = agentSessionController.enforceDeadline();
        if (deadlineCheck.outcome === "failed") {
          throw new Error(`Player action missed live deadline: ${deadlineCheck.reason}`);
        }
        const shouldCue =
          djState.type === "playing" ||
          djState.type === "cueing" ||
          djState.type === "planned" ||
          djState.type === "crossfading";

        if (shouldCue) {
          const heard = activeTrackHeardRef.current;
          const audibleSec = heard?.trackId === activeTrack?.id
            ? heard.audibleSec
            : 0;
          const notBeforeSec = minimumDwellExitSec({
            currentSourceSec: playback.currentTimeSec,
            audibleSec,
            playbackRate: activePlaybackRate,
          });
          const boundedPerformancePlan: PlayerToolInput["performance"] = {
            ...performancePlan,
            exit: performancePlan.exit.anchor === "time"
              ? {
                  ...performancePlan.exit,
                  timeSec: Math.max(performancePlan.exit.timeSec, notBeforeSec),
                }
              : {
                  ...performancePlan.exit,
                  notBeforeSec: Math.max(performancePlan.exit.notBeforeSec ?? 0, notBeforeSec),
                },
          };
          await cueNextTrack(newTrack, boundedPerformancePlan);
        } else {
          await loadInitialTrack(newTrack);
          await play();
        }
        const completedDeadlineCheck = agentSessionController.enforceDeadline();
        if (completedDeadlineCheck.outcome === "failed") {
          throw new Error(
            `Player action completed after live deadline: ${completedDeadlineCheck.reason}`,
          );
        }
        if (shouldCue && activeTrack) {
          performanceMemoryRef.current = appendConfirmedTransition(
            performanceMemoryRef.current,
            {
              from: compactPerformanceTrack(activeTrack),
              to: compactPerformanceTrack(newTrack),
              energyArc: performancePlan.energyArc,
              reason: performancePlan.reason,
              outcome: "queued",
            },
          );
        }
        agentSessionController.resolvePlayerAction({
          sessionId: agentSession.id,
          activeTrackId: agentSession.activeTrackId,
          succeeded: true,
        });
        playbackDebug("player.tool_request.done", {
          trackId: id,
          state: djState.type,
          mode: shouldCue ? "cue" : "initial_play",
          elapsedMs: Math.round(performance.now() - startedAt),
          performanceReason: performancePlan.reason,
          agentSessionId: agentSession.id,
        });
      } catch (error) {
        agentSessionController.resolvePlayerAction({
          sessionId: agentSession.id,
          activeTrackId: agentSession.activeTrackId,
          succeeded: false,
        });
        throw error;
      }
    },
    [
      activeTrack?.id,
      activePlaybackRate,
      agentSessionController,
      cueNextTrack,
      djState.type,
      loadInitialTrack,
      play,
      playback.currentTimeSec,
    ],
  );

  const { setPalette } = actions;
  const activeTrackLiked = activeTrack
    ? likeOverrides[activeTrack.id] ?? Boolean(activeTrack.user_favorite)
    : false;

  useEffect(() => {
    const id = activeTrack?.id;
    if (!Number.isFinite(id)) {
      activeTrackHeardRef.current = null;
      return;
    }
    activeTrackHeardRef.current = advanceAudibleDwell(activeTrackHeardRef.current, {
      trackId: id as number,
      sourceSec: playback.currentTimeSec,
      playbackRate: activePlaybackRate,
      playing: isPlaying,
    });
  }, [activePlaybackRate, activeTrack?.id, isPlaying, playback.currentTimeSec]);

  useEffect(() => {
    const id = activeTrack?.id;
    if (!Number.isFinite(id)) return;
    const history = playedTrackIdsRef.current.filter((trackId) => trackId !== id);
    history.push(id as number);
    playedTrackIdsRef.current = history.slice(-32);
    if (activeTrack) {
      performanceMemoryRef.current = appendPlayedTrack(
        performanceMemoryRef.current,
        compactPerformanceTrack(activeTrack),
      );
    }
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
    performanceMemory: performanceMemoryRef.current,
    lastTransitionOutcome:
      engine.diagnosticsRef.current.transitionMetrics.at(-1) ?? null,
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

  const finishAgentSession = useCallback((
    outcome: "completed" | "error" | "aborted" | "agent_holding_loop",
  ) => {
    const session = agentSessionController.getActive();
    if (!session) return;
    const terminal = classifyAgentSessionTerminal({
      outcome,
      state: session.state,
    });
    if (terminal === "awaiting_continuation") {
      playbackDebug("dj.agent_session.awaiting_plan", {
        agentSessionId: session.id,
      });
      return;
    }
    agentSessionController.close(session.id, terminal);
    clearAgentSessionDeadline();
    playbackDebug(
      terminal === "agent_holding_loop"
        ? "dj.agent_session.failed"
        : "dj.agent_session.closed",
      {
      agentSessionId: session.id,
      terminal,
      },
    );
  }, [agentSessionController, clearAgentSessionDeadline]);

  const rememberScheduledCandidates = useCallback((trackIds: number[]) => {
    performanceMemoryRef.current = appendScheduledCandidates(
      performanceMemoryRef.current,
      trackIds,
    );
  }, []);

  const authorizeAgentContinuation = useCallback(() => {
    const result = agentSessionController.recordContinuation();
    if (result.outcome === "continued") return true;
    clearAgentSessionDeadline();
    playbackDebug("dj.agent_session.failed", {
      reason: result.reason,
      stage: "continuation",
      count: "count" in result ? result.count : null,
    });
    return false;
  }, [agentSessionController, clearAgentSessionDeadline]);

  const observeAgentTransport = useCallback((transportStatus: "submitted" | "streaming" | "ready" | "error") => {
    agentSessionController.observeTransport(transportStatus);
  }, [agentSessionController]);

  const { messages, sendMessage, status, stop } = useRevibeChat({
    onPlayerToolRequested,
    getDJState,
    getAgentSession: agentSessionController.getActive,
    onAgentContinuationRequested: authorizeAgentContinuation,
    onAgentSessionFinished: finishAgentSession,
    onScheduledCandidates: rememberScheduledCandidates,
    onTransportStatus: observeAgentTransport,
    isTransitionBlocked: () =>
      djState.type === "cueing" ||
      djState.type === "planned" ||
      djState.type === "crossfading",
  });

  useEffect(() => {
    return () => {
      clearAgentSessionDeadline();
    };
  }, [clearAgentSessionDeadline]);

  useEffect(() => {
    const session = agentSessionController.getActive();
    if (!session || activeTrack?.id === session.activeTrackId) return;
    agentSessionController.close(session.id, "aborted");
    clearAgentSessionDeadline();
    playbackDebug("dj.agent_session.closed", {
      agentSessionId: session.id,
      terminal: "aborted",
      reason: "active_track_changed",
    });
    if (status === "submitted" || status === "streaming") {
      stop();
    }
  }, [activeTrack?.id, agentSessionController, clearAgentSessionDeadline, status, stop]);

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
        case "loadPlayAndSignIn": {
          const playbackRequest = (async () => {
            const initialTrack = (await fetchTrack(initialTrackId)) as SoundCloudTrack;
            await loadInitialTrack(initialTrack);
            await play();
          })();
          await Promise.all([playbackRequest, signIn("anonymous")]);
          return;
        }
        case "loadAndPlay": {
          const initialTrack = (await fetchTrack(initialTrackId)) as SoundCloudTrack;
          await loadInitialTrack(initialTrack);
          await play();
          return;
        }
        case "togglePlaybackAndSignIn":
          await Promise.all([togglePlay(), signIn("anonymous")]);
          return;
        case "togglePlayback":
          return togglePlay();
        case "continue":
          break;
      }

      if (status === "submitted" || status === "streaming") {
        playbackDebug("dj.agent_session.failed", {
          reason: "agent_holding_loop",
          stage: "session_open",
          eventType: e.type,
          transportStatus: status,
        });
        return;
      }

      const currentTrack = activeTrack as SoundCloudTrack | null;
      if (!currentTrack) return;
      const nowMs = Date.now();
      const remainingSec = Math.max(
        0,
        playback.durationSec - playback.currentTimeSec,
      );
      const sessionOpen = agentSessionController.open({
        source: isAutoRequest ? "planning_window" : "user",
        activeTrackId: currentTrack.id,
        deadlineAtMs: computePlaybackAgentSessionDeadlineAtMs({
          nowMs,
          remainingSec,
          durationSec: playback.durationSec,
        }),
      });
      if (sessionOpen.outcome === "failed") {
        playbackDebug("dj.agent_session.failed", {
          reason: sessionOpen.reason,
          stage: "session_open",
          eventType: e.type,
          activeAgentSessionId: sessionOpen.session.id,
        });
        return;
      }

      clearAgentSessionDeadline();
      const deadlineDelayMs = Math.max(0, sessionOpen.session.deadlineAtMs - Date.now());
      agentSessionDeadlineTimerRef.current = setTimeout(() => {
        const activeSession = agentSessionController.getActive();
        if (activeSession?.id !== sessionOpen.session.id) return;
        const deadlineResult = agentSessionController.enforceDeadline();
        if (deadlineResult.outcome !== "failed") return;
        playbackDebug("dj.agent_session.failed", {
          reason: deadlineResult.reason,
          stage: "deadline",
          agentSessionId: sessionOpen.session.id,
        });
        stop();
      }, deadlineDelayMs);
      playbackDebug("dj.agent_session.opened", {
        agentSessionId: sessionOpen.session.id,
        revision: sessionOpen.session.revision,
        source: sessionOpen.session.source,
        activeTrackId: sessionOpen.session.activeTrackId,
        deadlineAtMs: sessionOpen.session.deadlineAtMs,
      });

      let detectedBpm = currentTrack?.bpm ?? null;
      if (!detectedBpm && bpmDetectorRef.current?.hasReliableBPM()) {
        detectedBpm = bpmDetectorRef.current.getBPM();
      }

      const prompt = buildRevibePrompt({
        track: currentTrack,
        detectedBpm,
        continuityMode: isAutoRequest,
      });

      try {
        performanceMemoryRef.current = {
          ...performanceMemoryRef.current,
          intent: prompt,
        };
        await sendMessage({ role: "user", text: prompt });
        playbackDebug("player.revibe.prompt_sent", {
          eventType: e.type,
          activeTrackId: currentTrack.id,
          agentSessionId: sessionOpen.session.id,
        });
      } catch (error) {
        finishAgentSession("error");
        throw error;
      }
    },
    [
      activeTrack,
      activeDeck,
      agentSessionController,
      bpmDetectorRef,
      clearAgentSessionDeadline,
      finishAgentSession,
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
      playback.currentTimeSec,
      playback.durationSec,
      stop,
    ],
  );

  useEffect(() => {
    latestOnRevibeRef.current = onRevibe;
  }, [onRevibe]);

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
        audioBeatRef={audioBeatRef}
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
        liveSessionKey={liveSessionKey}
        onCanvasReady={setBroadcastCanvas}
        broadcastPortrait={broadcastPortrait}
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
    </>
  );
}
