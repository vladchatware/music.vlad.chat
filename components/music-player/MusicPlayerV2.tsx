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
import { useAgentDJStore } from "@/lib/dj/agent";

/**
 * Build comprehensive DJ state prompt for the AI
 */
function buildDJStatePrompt(opts: {
  track: { title?: string; user?: { username?: string; full_name?: string }; genre?: string; bpm?: number; key_signature?: string } | null;
  detectedBpm: number | null;
  section: string;
  overallEnergy: number;
  bassEnergy: number;
  currentTimeSec: number;
  durationSec: number;
  progress: number;
  vibe: string;
  mixIntensity: string;
  harmonicMode: string;
}): string {
  const lines: string[] = [];
  
  // Current track info
  if (opts.track) {
    lines.push(`CURRENT TRACK: "${opts.track.title}" by ${opts.track.user?.username || opts.track.user?.full_name || 'Unknown'}`);
    lines.push(`  BPM: ${opts.track.bpm || opts.detectedBpm || 'unknown'}`);
    lines.push(`  Key: ${(opts.track as any).key_signature || 'unknown'}`);
    lines.push(`  Genre: ${opts.track.genre || 'unknown'}`);
    lines.push(`  Position: ${Math.round(opts.currentTimeSec)}s / ${Math.round(opts.durationSec)}s (${opts.progress}%)`);
  } else {
    lines.push("CURRENT TRACK: None loaded");
  }
  
  lines.push('');
  
  // Real-time analysis
  lines.push(`ANALYSIS:`);
  lines.push(`  Section: ${opts.section}`);
  lines.push(`  Energy: ${opts.overallEnergy}%`);
  lines.push(`  Bass Energy: ${opts.bassEnergy}%`);
  
  lines.push('');
  
  // Current settings
  lines.push(`CURRENT SETTINGS:`);
  lines.push(`  Vibe: ${opts.vibe}`);
  lines.push(`  Mix Intensity: ${opts.mixIntensity}`);
  lines.push(`  Harmonic Mode: ${opts.harmonicMode}`);
  
  lines.push('');
  lines.push('Select the next track and schedule the transition using scheduleActions.');
  
  return lines.join('\n');
}

export default function MusicPlayerV2(props: { initialTrackId: string | number }) {
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
  
  // Revibe lock to prevent race conditions
  const revibeInProgressRef = useRef(false);
  
  // Track compatibility state for two-phase workflow
  const pendingCompatibilityRef = useRef<{
    trackId: number;
    compatibility: import('./engine/useDJEngine').TrackCompatibility;
  } | null>(null);

  // Use the new DJ engine with track analysis callback
  const engine = useDJEngine({
    isIOS,
    onRequestNextTrack: async () => {
      if (latestOnRevibeRef.current) {
        await latestOnRevibeRef.current(new Event("revibe"));
      }
    },
    onTrackAnalyzed: (compatibility) => {
      // Store compatibility for use in the second AI message
      const storeState = useMusicPlayerStore.getState();
      const incomingTrack = engine.djState.type === 'cueing' 
        ? (storeState.trackB?.id || storeState.trackA?.id) 
        : null;
      if (incomingTrack) {
        pendingCompatibilityRef.current = {
          trackId: incomingTrack,
          compatibility,
        };
      }
      console.log('[DJ] Track analyzed:', compatibility.isGoodMatch ? 'GOOD MATCH' : 'POOR MATCH', 
        `score=${(compatibility.score * 100).toFixed(0)}%`);
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
    async (id: number, startAtSec?: number): Promise<string> => {
      const newTrack = (await fetchTrack(id)) as SoundCloudTrack;
      
      // Store start position for the incoming track (will be used when crossfade starts)
      if (startAtSec && startAtSec > 0) {
        (newTrack as any)._startAtSec = startAtSec;
      }

      if (isPlaying) {
        await cueNextTrack(newTrack);
        
        // Wait for track analysis to complete (up to 4 seconds)
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        // Check compatibility and build report as tool result (NOT a separate message)
        const compatibility = engine.getTrackCompatibility?.();
        
        // Build compatibility report for tool result
        const playback = useMusicPlayerStore.getState().playback;
        const currentTime = playback.currentTimeSec;
        const duration = playback.durationSec;
        
        const lines: string[] = [];
        lines.push(`Track cued: "${newTrack.title}" by ${newTrack.user?.username || 'Unknown'}`);
        lines.push(`BPM: ${newTrack.bpm || 'unknown'}, Key: ${(newTrack as any).key_signature || 'unknown'}`);
        
        if (compatibility) {
          lines.push('');
          lines.push('=== TRACK ANALYSIS COMPLETE ===');
          lines.push(`Compatibility Score: ${(compatibility.score * 100).toFixed(0)}%`);
          lines.push(`  - Harmonic: ${(compatibility.harmonicScore * 100).toFixed(0)}%`);
          lines.push(`  - Tempo: ${(compatibility.tempoScore * 100).toFixed(0)}%`);
          lines.push(`  - Energy: ${(compatibility.energyScore * 100).toFixed(0)}%`);
          
          if (compatibility.issues.length > 0) {
            lines.push('');
            lines.push('ISSUES:');
            compatibility.issues.forEach(issue => lines.push(`  ⚠ ${issue}`));
          }
          
          lines.push('');
          lines.push('RECOMMENDED TRANSITION:');
          lines.push(`  Exit current track at: ${compatibility.optimalTransitionPoint.toFixed(1)}s`);
          lines.push(`  Start incoming track at: ${compatibility.analyzedStartPosition.toFixed(1)}s`);
          lines.push(`  Current position: ${currentTime.toFixed(1)}s / ${duration.toFixed(1)}s`);
          lines.push(`  Time until transition: ${(compatibility.optimalTransitionPoint - currentTime).toFixed(1)}s`);
          
          if (!compatibility.isGoodMatch) {
            lines.push('');
            lines.push('⚠ POOR MATCH - Consider rejectTrack for a different selection, or use longer crossfade with aggressive EQ.');
          } else {
            lines.push('');
            lines.push('✓ GOOD MATCH - Use scheduleActions to plan the transition.');
          }
        }
        
        // Fallback: If AI didn't schedule actions within a reasonable time, create default
        setTimeout(() => {
          const playback = useMusicPlayerStore.getState().playback;
          const currentTime = playback.currentTimeSec;
          const duration = playback.durationSec;
          const timeLeft = duration - currentTime;
          
          // Check if AI has scheduled anything
          if (timeLeft > 15 && timeLeft < 60 && engine.scheduleActions) {
            const crossfadeStart = Math.max(currentTime + 5, duration - 20);
            engine.scheduleActions([
              { atSec: crossfadeStart, action: 'startCrossfade', params: { durationSec: 16, style: 'bassSwap' } },
              { atSec: crossfadeStart + 8, action: 'swapBass', params: {} }
            ]);
          }
        }, 30000); // Give AI 30 seconds to respond
        
        // Clear revibe lock after track loads
        revibeInProgressRef.current = false;
        
        return lines.join('\n');
      } else {
        await loadInitialTrack(newTrack);
        await play();
        
        // Clear revibe lock after track loads
        revibeInProgressRef.current = false;
        return `Playing ${newTrack.title}`;
      }
    },
    [cueNextTrack, isPlaying, loadInitialTrack, play, engine],
  );
  
  // Handle scheduled actions from AI
  const onScheduleActions = useCallback((actions: Array<{ atSec: number; action: string; params?: Record<string, any> }>) => {
    // Pass to DJ engine for scheduled execution
    engine.scheduleActions?.(actions);
  }, [engine]);

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

  // Handle track rejection - AI requests a different track
  const onRejectTrack = useCallback(async (reason: string) => {
    console.log(`[DJ] AI rejected track: ${reason}`);
    // Cancel the current cued track
    engine.cancelTransition?.();
    // Request a new track by triggering revibe again
    revibeInProgressRef.current = false; // Allow new revibe
    if (latestOnRevibeRef.current) {
      await latestOnRevibeRef.current(new Event("rejectTrack"));
    }
  }, [engine]);

  const { messages, sendMessage, status } = useRevibeChat({ 
    onPlayerToolRequested,
    onScheduleActions,
    onRejectTrack,
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

      // Prevent race conditions - only one revibe at a time
      if (revibeInProgressRef.current) {
        console.log('[Revibe] Skipped - already in progress');
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

      // Set revibe lock
      revibeInProgressRef.current = true;

      const currentTrack = activeTrack as SoundCloudTrack | null;

      let detectedBpm = currentTrack?.bpm ?? null;
      if (!detectedBpm && bpmDetectorRef.current?.hasReliableBPM()) {
        detectedBpm = bpmDetectorRef.current.getBPM();
      }

      // Build DJ state context for the AI
      const playerState = useMusicPlayerStore.getState();
      const agentSettings = useAgentDJStore.getState().settings;
      const analysis = playerState.analysis;
      const playbackState = playerState.playback;
      
      const stateContext = buildDJStatePrompt({
        track: currentTrack,
        detectedBpm,
        section: analysis.section,
        overallEnergy: Math.round(analysis.overallEnergy * 100),
        bassEnergy: Math.round(analysis.bassEnergy * 100),
        currentTimeSec: playbackState.currentTimeSec,
        durationSec: playbackState.durationSec,
        progress: Math.round(playbackState.progress01 * 100),
        vibe: agentSettings.vibe,
        mixIntensity: agentSettings.intensity,
        harmonicMode: agentSettings.harmonicMode,
      });

      sendMessage({ role: "user", text: stateContext });
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
