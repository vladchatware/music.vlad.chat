"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useShallow } from "zustand/react/shallow";

import FFTAnalyzer from "@/lib/analyzers/ftt";
import { BPMDetector } from "@/lib/analyzers/bpm-detector";

import { cueTrackOnDeck } from "./cueing";
import { type SoundCloudTrack } from "../types";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";

export function useDualDeckEngine(opts: {
  isIOS: boolean;
  onRevibeRef: MutableRefObject<((e: Event) => Promise<void> | void) | null>;
}) {
  const { isIOS, onRevibeRef } = opts;

  // Decks
  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const deckASourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const deckBSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const deckAGainRef = useRef<GainNode | null>(null);
  const deckBGainRef = useRef<GainNode | null>(null);
  const activeDeckRef = useRef<"A" | "B">("A");

  // Cue/crossfade state
  const crossfadeInProgressRef = useRef(false);
  const nextTrackReadyRef = useRef(false);
  const waitingForBeatRef = useRef(false);
  const trackEndedWhileCueingRef = useRef(false);

  // Analysis
  const analyzerRef = useRef<FFTAnalyzer | null>(null);
  const cueAnalyzerRef = useRef<FFTAnalyzer | null>(null);
  const bpmDetectorRef = useRef<BPMDetector | null>(null);
  const audioEnergyRef = useRef(0);

  // UI-ish state
  const { trackA, trackB, activeTrack, phase, loading, actions } = useMusicPlayerStore(
    useShallow((s) => ({
      trackA: s.trackA,
      trackB: s.trackB,
      activeTrack: s.activeTrack,
      phase: s.phase,
      loading: s.loading,
      actions: s.actions,
    })),
  );

  const needsUserInteraction = phase === "needsGesture";
  const isPlaying =
    phase === "playing" || phase === "cueingNext" || phase === "crossfading";

  // Avoid stale closures
  const revibeTriggeredRef = useRef(false);

  // Singleton store hygiene: clear UI state only when the last instance unmounts.
  useEffect(() => {
    actions.acquire();
    return () => {
      actions.release();
    };
  }, [actions]);

  // Unlock both audio decks on iOS Safari (needs user gesture)
  const unlockAudioRef = useRef(false);
  const unlockAudio = useCallback(async () => {
    if (unlockAudioRef.current) return;
    unlockAudioRef.current = true;

    // Resume AudioContext if suspended
    if (analyzerRef.current?._audioCtx?.state === "suspended") {
      await analyzerRef.current._audioCtx.resume();
    }

    const unlockDeck = async (deck: HTMLAudioElement | null) => {
      if (!deck) return;
      const originalSrc = deck.src;
      const originalTime = deck.currentTime;
      const originalMuted = deck.muted;
      const originalVolume = deck.volume;

      if (!deck.src) {
        deck.src =
          "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYkYpNsAAAAAAAAAAAAAAAAAAAA//tQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tQZB8P8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";
      }

      deck.muted = true;
      deck.volume = 0;

      try {
        await deck.play();
        deck.pause();
      } catch (e) {
        console.log("Deck unlock skipped:", e);
      }

      deck.src = originalSrc;
      deck.currentTime = originalTime;
      deck.muted = originalMuted;
      deck.volume = originalVolume;
    };

    await Promise.all([unlockDeck(deckARef.current), unlockDeck(deckBRef.current)]);
  }, []);

  const getActiveDeck = useCallback(() => {
    return activeDeckRef.current === "A" ? deckARef.current : deckBRef.current;
  }, []);

  const playActiveDeck = useCallback(async () => {
    const audio = getActiveDeck();
    if (!audio || !audio.src) {
      return;
    }
    await unlockAudio();
    await audio.play();
    actions.dispatchEngine({ type: "PLAYING" });
  }, [actions, getActiveDeck, unlockAudio]);

  const pauseActiveDeck = useCallback(() => {
    const audio = getActiveDeck();
    if (!audio) return;
    audio.pause();
    actions.dispatchEngine({ type: "PAUSED" });
  }, [actions, getActiveDeck]);

  const togglePlay = useCallback(async () => {
    const audio = getActiveDeck();
    if (!audio || !audio.src) {
      return;
    }

    try {
      // Decide based on the actual media element state, not store phase.
      // (Store phase can transiently flip during unlockAudio() in dev.)
      if (!audio.paused) {
        pauseActiveDeck();
      } else {
        await playActiveDeck();
      }
    } catch (err: any) {
      console.error("Playback error:", err);
      if (err?.name === "NotAllowedError") {
        alert("Please click the play button to start audio playback");
      }
    }
  }, [getActiveDeck, pauseActiveDeck, playActiveDeck, unlockAudio]);

  const crossfadeToCuedTrack = useCallback(
    async (opts?: { wasTrackEnded?: boolean }) => {
      if (crossfadeInProgressRef.current) return;
      if (!nextTrackReadyRef.current) return;

      const wasTrackEnded = opts?.wasTrackEnded ?? false;

      waitingForBeatRef.current = false;
      nextTrackReadyRef.current = false;
      const wasCueingEnded = trackEndedWhileCueingRef.current;
      trackEndedWhileCueingRef.current = false;
      crossfadeInProgressRef.current = true;
      actions.dispatchEngine({ type: "CROSSFADE_START" });

      const isAActive = activeDeckRef.current === "A";
      const currentDeck = isAActive ? deckARef.current : deckBRef.current;
      const nextDeck = isAActive ? deckBRef.current : deckARef.current;
      const currentGain = isAActive ? deckAGainRef.current : deckBGainRef.current;
      const nextGain = isAActive ? deckBGainRef.current : deckAGainRef.current;
      const nextSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;
      const { trackA, trackB } = useMusicPlayerStore.getState();
      const nextTrack = isAActive ? trackB : trackA;

      if (!currentDeck || !nextDeck || !nextTrack) {
        crossfadeInProgressRef.current = false;
        return;
      }

      if (nextGain) nextGain.gain.value = 0;
      else nextDeck.volume = 0;

      try {
        await nextDeck.play();
      } catch (e) {
        console.error("Crossfade play failed", e);
        crossfadeInProgressRef.current = false;
        nextTrackReadyRef.current = true;
        return;
      }

      activeDeckRef.current = isAActive ? "B" : "A";
      actions.setActiveTrack({ ...nextTrack });
      actions.dispatchEngine({ type: "PLAYING" });

      if (!isIOS && nextSource && analyzerRef.current) {
        try {
          analyzerRef.current.disconnectInputs();
          analyzerRef.current.connectInput(nextSource);
        } catch (e) {
          console.warn("Analyzer rewire failed:", e);
        }
      }

      const crossfadeDuration = wasTrackEnded || wasCueingEnded ? 500 : 2000;
      const startTime = performance.now();
      const initialCurrent = currentGain ? currentGain.gain.value : currentDeck.volume;
      const initialNext = nextGain ? nextGain.gain.value : nextDeck.volume;

      const crossfade = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / crossfadeDuration, 1);
        const eased =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        const nextVal = initialNext + (1 - initialNext) * eased;
        const currVal = initialCurrent * (1 - eased);

        if (currentGain && nextGain) {
          currentGain.gain.value = currVal;
          nextGain.gain.value = nextVal;
        } else {
          currentDeck.volume = currVal;
          nextDeck.volume = nextVal;
        }

        if (progress < 1) {
          requestAnimationFrame(crossfade);
        } else {
          try {
            currentDeck.pause();
          } catch {}
          if (currentGain && nextGain) {
            currentGain.gain.value = 0;
            nextGain.gain.value = 1;
          } else {
            currentDeck.volume = 0;
            nextDeck.volume = 1;
          }
          crossfadeInProgressRef.current = false;
          bpmDetectorRef.current?.reset();
          actions.dispatchEngine({ type: "CROSSFADE_END" });
        }
      };

      requestAnimationFrame(crossfade);
    },
    [actions, isIOS],
  );

  const loadInitialTrack = useCallback(async (track: SoundCloudTrack) => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA) return;

    actions.dispatchEngine({ type: "SET_LOADING", loading: true });
    try {
      deckA.pause();
      deckB?.pause();
    } catch {}

    if (deckAGainRef.current) deckAGainRef.current.gain.value = 1;
    if (deckBGainRef.current) deckBGainRef.current.gain.value = 0;
    if (deckA) deckA.volume = 1;
    if (deckB) deckB.volume = 0;

    actions.setTrackA(track);
    actions.setActiveTrack(track);
    activeDeckRef.current = "A";
    actions.dispatchEngine({ type: "NEEDS_GESTURE" });
    actions.dispatchEngine({ type: "SET_LOADING", loading: false });
  }, [actions]);

  const cueTrackOnInactiveDeck = useCallback(
    async (track: SoundCloudTrack) => {
      actions.dispatchEngine({ type: "SET_LOADING", loading: true });

      const isAActive = activeDeckRef.current === "A";
      const targetDeck = isAActive ? deckBRef.current : deckARef.current;
      const targetSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;

      if (isAActive) actions.setTrackB(track);
      else actions.setTrackA(track);
      waitingForBeatRef.current = true;
      nextTrackReadyRef.current = false;
      trackEndedWhileCueingRef.current = false;
      actions.dispatchEngine({ type: "CUEING_START" });

      const onLoaded = async () => {
        if (!targetDeck) return;

        const targetGain = isAActive ? deckBGainRef.current : deckAGainRef.current;
        if (targetGain) targetGain.gain.value = 0;

        const connectAnalyzerInput = (analyzer: FFTAnalyzer) => {
          if (targetSource) {
            analyzer.disconnectInputs();
            analyzer.connectInput(targetSource);
          }
        };

        await cueTrackOnDeck({
          targetDeck,
          cueAnalyzer: cueAnalyzerRef.current,
          connectAnalyzerInput,
          setLoading: (loading) => actions.dispatchEngine({ type: "SET_LOADING", loading }),
          waitingForBeatRef,
          nextTrackReadyRef,
        });
        actions.dispatchEngine({ type: "CUE_READY" });

        targetDeck.removeEventListener("loadeddata", onLoaded);
      };

      targetDeck?.addEventListener("loadeddata", onLoaded);
    },
    [actions],
  );

  const loadActiveDeckAndAutoplay = useCallback(
    async (track: SoundCloudTrack) => {
      const deckA = deckARef.current;
      if (!deckA) return;

      actions.dispatchEngine({ type: "SET_LOADING", loading: true });
      actions.setTrackA(track);
      actions.setActiveTrack(track);
      activeDeckRef.current = "A";

      const onLoaded = () => {
        actions.dispatchEngine({ type: "SET_LOADING", loading: false });
        void togglePlay();
        deckA.removeEventListener("loadeddata", onLoaded);
      };

      deckA.addEventListener("loadeddata", onLoaded);
    },
    [actions, togglePlay],
  );

  // WebAudio + analyzer wiring
  useEffect(() => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA || !deckB) return;

    deckA.volume = 1;
    deckB.volume = 0;

    if (!isIOS) {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextCtor();

      deckA.crossOrigin = "anonymous";
      deckB.crossOrigin = "anonymous";

      const sourceA = ctx.createMediaElementSource(deckA);
      const sourceB = ctx.createMediaElementSource(deckB);

      const gainA = ctx.createGain();
      const gainB = ctx.createGain();
      gainA.gain.value = 1;
      gainB.gain.value = 0;

      sourceA.connect(gainA);
      sourceB.connect(gainB);
      gainA.connect(ctx.destination);
      gainB.connect(ctx.destination);

      deckASourceRef.current = sourceA;
      deckBSourceRef.current = sourceB;
      deckAGainRef.current = gainA;
      deckBGainRef.current = gainB;

      analyzerRef.current = new FFTAnalyzer(sourceA, ctx);
      cueAnalyzerRef.current = new FFTAnalyzer(sourceB, ctx);
    } else {
      deckASourceRef.current = null;
      deckBSourceRef.current = null;
      deckAGainRef.current = null;
      deckBGainRef.current = null;
      analyzerRef.current = null;
      cueAnalyzerRef.current = null;
    }

    bpmDetectorRef.current = new BPMDetector();

    return () => {
      const analyzer = analyzerRef.current;
      if (analyzer) {
        analyzer.toggleAnalyzer(false);
        analyzer.disconnectInputs();
      }
      const cueAnalyzer = cueAnalyzerRef.current;
      if (cueAnalyzer) {
        cueAnalyzer.toggleAnalyzer(false);
        cueAnalyzer.disconnectInputs();
      }

      try {
        deckA.pause();
        deckB.pause();
      } catch {}

      analyzerRef.current = null;
      cueAnalyzerRef.current = null;
      bpmDetectorRef.current = null;
    };
  }, [isIOS]);

  // Playback event listeners + revibe scheduling
  useEffect(() => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA || !deckB) return;

    const handlePlaying = (e: Event) => {
      const playingDeck = e.target as HTMLAudioElement;
      const isActiveDeck = playingDeck === (activeDeckRef.current === "A" ? deckA : deckB);

      if (isActiveDeck) {
        actions.dispatchEngine({ type: "PLAYING" });
        revibeTriggeredRef.current = false;
        // @ts-ignore OBS
        window.obsstudio?.startRecording();
      }
    };

    const handleEnded = async (e: Event) => {
      const audio = e.target as HTMLAudioElement;
      const isAActive = activeDeckRef.current === "A";
      const currentDeck = isAActive ? deckARef.current : deckBRef.current;
      if (audio === currentDeck && nextTrackReadyRef.current && !crossfadeInProgressRef.current) {
        await crossfadeToCuedTrack({ wasTrackEnded: true });
      } else if (audio === currentDeck && waitingForBeatRef.current) {
        trackEndedWhileCueingRef.current = true;
      } else if (audio === currentDeck && !crossfadeInProgressRef.current) {
        if (onRevibeRef.current) await onRevibeRef.current(e);
      }
      // @ts-ignore OBS
      window.obsstudio?.stopRecording();
    };

    const handleTimeUpdate = async (e: Event) => {
      const audio = e.target as HTMLAudioElement;
      if (audio !== (activeDeckRef.current === "A" ? deckARef.current : deckBRef.current)) return;

      const virtualDuration = Math.min(audio.duration, 90);

      if (
        audio.duration > 20 &&
        audio.currentTime > virtualDuration - 15 &&
        !revibeTriggeredRef.current &&
        !waitingForBeatRef.current &&
        !nextTrackReadyRef.current
      ) {
        revibeTriggeredRef.current = true;
        if (onRevibeRef.current) await onRevibeRef.current(e);
      }

      if (
        isIOS &&
        nextTrackReadyRef.current &&
        !crossfadeInProgressRef.current &&
        audio.duration > 20 &&
        audio.currentTime > virtualDuration - 3
      ) {
        await crossfadeToCuedTrack();
      }
    };

    [deckA, deckB].forEach((deck) => {
      deck.addEventListener("playing", handlePlaying);
      deck.addEventListener("ended", handleEnded);
      deck.addEventListener("timeupdate", handleTimeUpdate);
    });

    return () => {
      [deckA, deckB].forEach((deck) => {
        deck.removeEventListener("playing", handlePlaying);
        deck.removeEventListener("ended", handleEnded);
        deck.removeEventListener("timeupdate", handleTimeUpdate);
      });
    };
  }, [crossfadeToCuedTrack, isIOS, onRevibeRef]);

  return {
    // elements
    deckARef,
    deckBRef,

    // state
    trackA,
    trackB,
    activeTrack,
    isPlaying,
    needsUserInteraction,
    loading,
    phase,

    // actions
    togglePlay,
    playActiveDeck,
    pauseActiveDeck,
    loadInitialTrack,
    loadActiveDeckAndAutoplay,
    cueTrackOnInactiveDeck,
    crossfadeToCuedTrack,

    // analysis
    analyzerRef,
    cueAnalyzerRef,
    bpmDetectorRef,
    audioEnergyRef,

    // refs (for other hooks)
    activeDeckRef,
    crossfadeInProgressRef,
    waitingForBeatRef,
    nextTrackReadyRef,
    trackEndedWhileCueingRef,
  };
}

