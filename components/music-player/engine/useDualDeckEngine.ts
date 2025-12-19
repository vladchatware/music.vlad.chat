"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useShallow } from "zustand/react/shallow";

import FFTAnalyzer from "@/lib/analyzers/ftt";
import { BPMDetector } from "@/lib/analyzers/bpm-detector";

import { cueTrackOnDeck } from "./cueing";
import { type SoundCloudTrack } from "../types";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";

const FALLBACK_BPM = 120;
const DEFAULT_PHRASE_BARS = 16;
const AUTO_REVIBE_COOLDOWN_MS = 45000;
const AUTO_REVIBE_MIN_PLAY_SEC = 30;

// Transition filter tuning (WebAudio path only)
const FILTER_MIN_HPF_HZ = 20;
const FILTER_MAX_LPF_HZ = 20000;
const FILTER_SPLIT_HZ = 350;
const FILTER_Q = 0.7;

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
  const deckAHPFRef = useRef<BiquadFilterNode | null>(null);
  const deckALPFRef = useRef<BiquadFilterNode | null>(null);
  const deckALowRef = useRef<BiquadFilterNode | null>(null);
  const deckAMidRef = useRef<BiquadFilterNode | null>(null);
  const deckAHighRef = useRef<BiquadFilterNode | null>(null);

  const deckBHPFRef = useRef<BiquadFilterNode | null>(null);
  const deckBLPFRef = useRef<BiquadFilterNode | null>(null);
  const deckBLowRef = useRef<BiquadFilterNode | null>(null);
  const deckBMidRef = useRef<BiquadFilterNode | null>(null);
  const deckBHighRef = useRef<BiquadFilterNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
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
  const { trackA, trackB, activeTrack, phase, loading, knobs, actions } = useMusicPlayerStore(
    useShallow((s) => ({
      trackA: s.trackA,
      trackB: s.trackB,
      activeTrack: s.activeTrack,
      phase: s.phase,
      loading: s.loading,
      knobs: s.knobs,
      actions: s.actions,
    })),
  );

  const needsUserInteraction = phase === "needsGesture";
  const isPlaying =
    phase === "playing" || phase === "cueingNext" || phase === "crossfading";

  // Avoid stale closures
  const revibeTriggeredRef = useRef(false);
  const lastPlannedStartSecRef = useRef<number | null>(null);
  const autoRevibeAtMsRef = useRef<number>(0);
  const crossfadeScheduledRef = useRef(false);
  const plannedBarDurationSecRef = useRef<number | null>(null);

  const getActuallyPlayingDeck = useCallback((): "A" | "B" => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    const aPlaying = !!deckA && !!deckA.src && !deckA.paused && !deckA.ended;
    const bPlaying = !!deckB && !!deckB.src && !deckB.paused && !deckB.ended;
    if (aPlaying && !bPlaying) return "A";
    if (bPlaying && !aPlaying) return "B";
    return activeDeckRef.current;
  }, []);

  const getBpmSnapshot = useCallback(() => {
    const state = useMusicPlayerStore.getState();
    const metaBpm = (state.activeTrack as any)?.bpm;
    if (Number.isFinite(metaBpm) && metaBpm > 0) {
      return { bpm: Math.round(metaBpm), bpmSource: "metadata" as const };
    }
    const detector = bpmDetectorRef.current;
    const detected = detector?.hasReliableBPM() ? detector.getBPM() : null;
    if (detected && Number.isFinite(detected) && detected > 0) {
      return { bpm: Math.round(detected), bpmSource: "detector" as const };
    }
    return { bpm: FALLBACK_BPM, bpmSource: "fallback" as const };
  }, []);

  const getBarDurationSec = useCallback((bpm: number) => {
    const safe = Number.isFinite(bpm) && bpm > 0 ? bpm : FALLBACK_BPM;
    return (60 / safe) * 4; // 4/4
  }, []);

  const getNextBoundarySec = useCallback(
    (currentTimeSec: number, barDurationSec: number, phraseBars: number) => {
      const bars = Math.max(1, Math.floor(phraseBars));
      const barIndex = Math.floor(currentTimeSec / barDurationSec);
      const nextBoundaryBarIndex = (Math.floor(barIndex / bars) + 1) * bars;
      return nextBoundaryBarIndex * barDurationSec;
    },
    [],
  );

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

  const resetDeckFilters = useCallback((deck: "A" | "B") => {
    const hpf = deck === "A" ? deckAHPFRef.current : deckBHPFRef.current;
    const lpf = deck === "A" ? deckALPFRef.current : deckBLPFRef.current;
    if (!hpf || !lpf) return; // iOS / no WebAudio graph

    hpf.frequency.value = FILTER_MIN_HPF_HZ;
    lpf.frequency.value = FILTER_MAX_LPF_HZ;
  }, []);

  const playActiveDeck = useCallback(async () => {
    const audio = getActiveDeck();
    if (!audio || !audio.src) {
      return;
    }
    await unlockAudio();
    await audio.play();
    actions.dispatchEngine({ type: "PLAYING" });

    // @ts-ignore OBS
    window.obsstudio?.startRecording();
  }, [actions, getActiveDeck, unlockAudio]);

  const pauseActiveDeck = useCallback(() => {
    const audio = getActiveDeck();
    if (!audio) return;
    audio.pause();
    actions.dispatchEngine({ type: "PAUSED" });

    // @ts-ignore OBS
    window.obsstudio?.stopRecording();
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
      crossfadeScheduledRef.current = false;

      const isAActive = getActuallyPlayingDeck() === "A";
      const currentDeck = isAActive ? deckARef.current : deckBRef.current;
      const nextDeck = isAActive ? deckBRef.current : deckARef.current;
      const currentGain = isAActive ? deckAGainRef.current : deckBGainRef.current;
      const nextGain = isAActive ? deckBGainRef.current : deckAGainRef.current;
      const nextSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;
      const currentDeckKey: "A" | "B" = isAActive ? "A" : "B";
      const nextDeckKey: "A" | "B" = isAActive ? "B" : "A";

      const currentHPF =
        currentDeckKey === "A" ? deckAHPFRef.current : deckBHPFRef.current;
      const currentLPF =
        currentDeckKey === "A" ? deckALPFRef.current : deckBLPFRef.current;
      const nextHPF = nextDeckKey === "A" ? deckAHPFRef.current : deckBHPFRef.current;
      const nextLPF = nextDeckKey === "A" ? deckALPFRef.current : deckBLPFRef.current;
      const { trackA, trackB } = useMusicPlayerStore.getState();
      const nextTrack = isAActive ? trackB : trackA;

      if (!currentDeck || !nextDeck || !nextTrack) {
        crossfadeInProgressRef.current = false;
        return;
      }

      // When using GainNodes (WebAudio path), keep element volumes at 1.
      // Some browsers apply HTMLMediaElement volume before MediaElementSourceNode,
      // so leaving the inactive deck at volume=0 can mute the WebAudio graph.
      if (currentGain && nextGain) {
        currentDeck.volume = 1;
        nextDeck.volume = 1;
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

      // @ts-ignore OBS
      window.obsstudio?.startRecording();

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

      const { bpm } = getBpmSnapshot();
      const barDurationSec = getBarDurationSec(bpm);
      const crossfadeBars = 16;
      const intendedDurationMs = crossfadeBars * barDurationSec * 1000;
      const crossfadeDuration =
        wasTrackEnded || wasCueingEnded ? 500 : Math.min(120000, Math.max(2000, intendedDurationMs));

      actions.setTransition({
        state: "crossfading",
        durationSec: crossfadeDuration / 1000,
        progress01: 0,
      });

      const startTime = performance.now();
      const initialCurrent = currentGain ? currentGain.gain.value : currentDeck.volume;
      const initialNext = nextGain ? nextGain.gain.value : nextDeck.volume;

      // Initialize complementary filters (WebAudio path only).
      // Incoming starts high-passed around the split; outgoing starts full-range and will low-pass as fade progresses.
      if (currentHPF) currentHPF.frequency.value = FILTER_MIN_HPF_HZ;
      if (currentLPF) currentLPF.frequency.value = FILTER_MAX_LPF_HZ;
      if (nextHPF) nextHPF.frequency.value = FILTER_SPLIT_HZ;
      if (nextLPF) nextLPF.frequency.value = FILTER_MAX_LPF_HZ;

      const crossfade = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / crossfadeDuration, 1);
        actions.setTransition({ progress01: progress });
        const eased =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        const nextVal = initialNext + (1 - initialNext) * eased;
        const currVal = initialCurrent * (1 - eased);

        if (currentGain && nextGain) {
          currentGain.gain.value = currVal;
          nextGain.gain.value = nextVal;

          // Complementary split filtering:
          // - Outgoing LPF closes toward split (reduces HF clash)
          // - Incoming HPF opens down toward 20Hz by the end (restores full lows)
          if (currentLPF) {
            currentLPF.frequency.value =
              FILTER_MAX_LPF_HZ + (FILTER_SPLIT_HZ - FILTER_MAX_LPF_HZ) * eased;
          }
          if (currentHPF) currentHPF.frequency.value = FILTER_MIN_HPF_HZ;
          if (nextLPF) nextLPF.frequency.value = FILTER_MAX_LPF_HZ;
          if (nextHPF) {
            nextHPF.frequency.value =
              FILTER_SPLIT_HZ + (FILTER_MIN_HPF_HZ - FILTER_SPLIT_HZ) * eased;
          }
        } else {
          currentDeck.volume = currVal;
          nextDeck.volume = nextVal;
        }

        if (progress < 1) {
          requestAnimationFrame(crossfade);
        } else {
          try {
            currentDeck.pause();
          } catch { }
          if (currentGain && nextGain) {
            currentGain.gain.value = 0;
            nextGain.gain.value = 1;
            // Ensure both decks end full-range for future cueing/transitions.
            resetDeckFilters(nextDeckKey);
            resetDeckFilters(currentDeckKey);
          } else {
            currentDeck.volume = 0;
            nextDeck.volume = 1;
          }
          crossfadeInProgressRef.current = false;
          bpmDetectorRef.current?.reset();
          actions.dispatchEngine({ type: "CROSSFADE_END" });
          actions.resetTransition();

          // @ts-ignore OBS
          window.obsstudio?.stopRecording();
          // @ts-ignore OBS
          setTimeout(() => window.obsstudio?.startRecording(), 1000);
        }
      };

      requestAnimationFrame(crossfade);
    },
    [actions, getActuallyPlayingDeck, getBarDurationSec, getBpmSnapshot, isIOS, resetDeckFilters],
  );

  const crossfadeOnNextBeat = useCallback(
    async (opts?: { wasTrackEnded?: boolean }) => {
      const blocked =
        crossfadeInProgressRef.current ||
        !nextTrackReadyRef.current ||
        crossfadeScheduledRef.current;
      if (blocked) return;
      crossfadeScheduledRef.current = true;

      const start = () => {
        crossfadeScheduledRef.current = false;
        void crossfadeToCuedTrack(opts);
      };

      // If we have a beat predictor, align start to next beat (small window).
      const detector = bpmDetectorRef.current;
      if (!detector) return start();

      const maxWaitMs = 800;
      const startedAt = performance.now();

      const tick = () => {
        if (crossfadeInProgressRef.current) return;
        if (!nextTrackReadyRef.current) return;
        const ttn = detector.getTimeToNextBeat();
        if (ttn > 0 && ttn < 60) return start();
        if (performance.now() - startedAt > maxWaitMs) return start();
        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    },
    [crossfadeToCuedTrack],
  );

  const loadInitialTrack = useCallback(async (track: SoundCloudTrack) => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA) return;

    actions.dispatchEngine({ type: "SET_LOADING", loading: true });
    resetDeckFilters("A");
    resetDeckFilters("B");
    try {
      deckA.pause();
      deckB?.pause();
    } catch { }

    if (deckAGainRef.current) deckAGainRef.current.gain.value = 1;
    if (deckBGainRef.current) deckBGainRef.current.gain.value = 0;
    if (deckA) deckA.volume = 1;
    if (deckB) deckB.volume = deckBGainRef.current ? 1 : 0;

    actions.setTrackA(track);
    actions.setActiveTrack(track);
    activeDeckRef.current = "A";
    actions.dispatchEngine({ type: "NEEDS_GESTURE" });
    actions.dispatchEngine({ type: "SET_LOADING", loading: false });
  }, [actions, resetDeckFilters]);

  const cueTrackOnInactiveDeck = useCallback(
    async (track: SoundCloudTrack) => {
      actions.dispatchEngine({ type: "SET_LOADING", loading: true });

      // Self-heal: use actual media element state (activeDeckRef can drift if events are missed).
      const isAActive = getActuallyPlayingDeck() === "A";
      const targetDeck = isAActive ? deckBRef.current : deckARef.current;
      const targetSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;
      resetDeckFilters(isAActive ? "B" : "A");

      if (isAActive) actions.setTrackB(track);
      else actions.setTrackA(track);
      waitingForBeatRef.current = true;
      nextTrackReadyRef.current = false;
      trackEndedWhileCueingRef.current = false;
      lastPlannedStartSecRef.current = null;
      actions.resetTransition();
      actions.dispatchEngine({ type: "CUEING_START" });

      const onLoaded = async () => {
        if (!targetDeck) return;

        const targetGain = isAActive ? deckBGainRef.current : deckAGainRef.current;
        if (targetGain) targetGain.gain.value = 0;
        if (targetGain) targetDeck.volume = 1;

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

        // If the active track ended while we were cueing, timeupdate won't run anymore.
        // In that case, transition immediately (beat-aligned if possible).
        const active =
          getActuallyPlayingDeck() === "A" ? deckARef.current : deckBRef.current;
        const activeEnded =
          !!active && (active.ended || (Number.isFinite(active.duration) && active.currentTime >= active.duration - 0.05));
        if (trackEndedWhileCueingRef.current || activeEnded) {
          void crossfadeOnNextBeat({ wasTrackEnded: true });
        }

        targetDeck.removeEventListener("loadeddata", onLoaded);
      };

      targetDeck?.addEventListener("loadeddata", onLoaded);
    },
    [actions, getActuallyPlayingDeck, crossfadeOnNextBeat, resetDeckFilters],
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
    deckB.volume = isIOS ? 0 : 1;

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

      const hpfA = ctx.createBiquadFilter();
      hpfA.type = "highpass";
      hpfA.frequency.value = FILTER_MIN_HPF_HZ;
      hpfA.Q.value = FILTER_Q;

      const lpfA = ctx.createBiquadFilter();
      lpfA.type = "lowpass";
      lpfA.frequency.value = FILTER_MAX_LPF_HZ;
      lpfA.Q.value = FILTER_Q;

      const hpfB = ctx.createBiquadFilter();
      hpfB.type = "highpass";
      hpfB.frequency.value = FILTER_MIN_HPF_HZ;
      hpfB.Q.value = FILTER_Q;

      const lpfB = ctx.createBiquadFilter();
      lpfB.type = "lowpass";
      lpfB.frequency.value = FILTER_MAX_LPF_HZ;
      lpfB.Q.value = FILTER_Q;

      const lowA = ctx.createBiquadFilter();
      lowA.type = "lowshelf";
      lowA.frequency.value = 200;
      const midA = ctx.createBiquadFilter();
      midA.type = "peaking";
      midA.frequency.value = 1000;
      midA.Q.value = 1;
      const highA = ctx.createBiquadFilter();
      highA.type = "highshelf";
      highA.frequency.value = 5000;

      const lowB = ctx.createBiquadFilter();
      lowB.type = "lowshelf";
      lowB.frequency.value = 200;
      const midB = ctx.createBiquadFilter();
      midB.type = "peaking";
      midB.frequency.value = 1000;
      midB.Q.value = 1;
      const highB = ctx.createBiquadFilter();
      highB.type = "highshelf";
      highB.frequency.value = 5000;

      const masterGain = ctx.createGain();
      masterGain.gain.value = knobs.volume;

      sourceA.connect(hpfA);
      hpfA.connect(lpfA);
      lpfA.connect(lowA);
      lowA.connect(midA);
      midA.connect(highA);
      highA.connect(gainA);

      sourceB.connect(hpfB);
      hpfB.connect(lpfB);
      lpfB.connect(lowB);
      lowB.connect(midB);
      midB.connect(highB);
      highB.connect(gainB);

      gainA.connect(masterGain);
      gainB.connect(masterGain);
      masterGain.connect(ctx.destination);

      deckASourceRef.current = sourceA;
      deckBSourceRef.current = sourceB;
      deckAGainRef.current = gainA;
      deckBGainRef.current = gainB;
      masterGainRef.current = masterGain;
      deckAHPFRef.current = hpfA;
      deckALPFRef.current = lpfA;
      deckALowRef.current = lowA;
      deckAMidRef.current = midA;
      deckAHighRef.current = highA;
      deckBHPFRef.current = hpfB;
      deckBLPFRef.current = lpfB;
      deckBLowRef.current = lowB;
      deckBMidRef.current = midB;
      deckBHighRef.current = highB;

      resetDeckFilters("A");
      resetDeckFilters("B");

      analyzerRef.current = new FFTAnalyzer(sourceA, ctx);
      cueAnalyzerRef.current = new FFTAnalyzer(sourceB, ctx);
    } else {
      deckASourceRef.current = null;
      deckBSourceRef.current = null;
      deckAGainRef.current = null;
      deckBGainRef.current = null;
      deckAHPFRef.current = null;
      deckALPFRef.current = null;
      deckBHPFRef.current = null;
      deckBLPFRef.current = null;
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
      } catch { }

      analyzerRef.current = null;
      cueAnalyzerRef.current = null;
      bpmDetectorRef.current = null;
      deckASourceRef.current = null;
      deckBSourceRef.current = null;
      deckAGainRef.current = null;
      deckBGainRef.current = null;
      masterGainRef.current = null;
      deckAHPFRef.current = null;
      deckALPFRef.current = null;
      deckALowRef.current = null;
      deckAMidRef.current = null;
      deckAHighRef.current = null;
      deckBHPFRef.current = null;
      deckBLPFRef.current = null;
      deckBLowRef.current = null;
      deckBMidRef.current = null;
      deckBHighRef.current = null;
    };
  }, [isIOS, resetDeckFilters]);

  // Sync knobs with audio graph
  useEffect(() => {
    const mapKnobToGain = (val: number) => {
      if (val <= 0.5) return (val / 0.5) * 40 - 40;
      return ((val - 0.5) / 0.5) * 6;
    };

    const apply = (deck: "A" | "B") => {
      const low = deck === "A" ? deckALowRef.current : deckBLowRef.current;
      const mid = deck === "A" ? deckAMidRef.current : deckBMidRef.current;
      const high = deck === "A" ? deckAHighRef.current : deckBHighRef.current;
      const hpf = deck === "A" ? deckAHPFRef.current : deckBHPFRef.current;
      const lpf = deck === "A" ? deckALPFRef.current : deckBLPFRef.current;
      if (!low || !mid || !high) return;

      const now = (low.context as AudioContext).currentTime;
      low.gain.setTargetAtTime(mapKnobToGain(knobs.low), now, 0.05);
      mid.gain.setTargetAtTime(mapKnobToGain(knobs.mid), now, 0.05);
      high.gain.setTargetAtTime(mapKnobToGain(knobs.high), now, 0.05);

      if (hpf && lpf) {
        // Use resonance for filter Q
        const baseQ = FILTER_Q;
        const resonanceBonus = knobs.resonance * 10;
        hpf.Q.setTargetAtTime(baseQ + resonanceBonus, now, 0.05);
        lpf.Q.setTargetAtTime(baseQ + resonanceBonus, now, 0.05);
      }
    };

    apply("A");
    apply("B");

    // Master volume
    const master = masterGainRef.current;
    if (master) {
      const now = master.context.currentTime;
      master.gain.setTargetAtTime(knobs.volume, now, 0.05);
    }
  }, [knobs]);

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
        lastPlannedStartSecRef.current = null;
        actions.resetTransition();
        // @ts-ignore OBS
        window.obsstudio?.startRecording();
      }
    };

    const handleEnded = async (e: Event) => {
      const audio = e.target as HTMLAudioElement;
      const isAActive = activeDeckRef.current === "A";
      const currentDeck = isAActive ? deckARef.current : deckBRef.current;

      if (audio !== currentDeck) return;

      const isTransitioning = crossfadeInProgressRef.current || (nextTrackReadyRef.current && waitingForBeatRef.current);

      if (nextTrackReadyRef.current && !crossfadeInProgressRef.current) {
        await crossfadeToCuedTrack({ wasTrackEnded: true });
      } else if (waitingForBeatRef.current) {
        trackEndedWhileCueingRef.current = true;
      } else if (!crossfadeInProgressRef.current) {
        if (onRevibeRef.current) await onRevibeRef.current(e);
      }

      if (!isTransitioning) {
        // @ts-ignore OBS
        window.obsstudio?.stopRecording();
      }
    };

    const handleTimeUpdate = async (e: Event) => {
      const audio = e.target as HTMLAudioElement;
      const deckA = deckARef.current;
      const deckB = deckBRef.current;
      if (!deckA || !deckB) return;

      // If we're not mid-crossfade, prefer the deck that is actually playing.
      // This prevents activeDeckRef drift from breaking planning/cueing.
      if (!crossfadeInProgressRef.current) {
        if (audio === deckA && !audio.paused) activeDeckRef.current = "A";
        if (audio === deckB && !audio.paused) activeDeckRef.current = "B";
      }

      if (audio !== (activeDeckRef.current === "A" ? deckA : deckB)) return;

      // Only schedule auto-revibe when we know the real track duration.
      // Previously we capped to 90s which caused forced revibes around ~75s.
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const virtualDuration = audio.duration;

      // Publish playback + musical clock snapshots
      const { bpm, bpmSource } = getBpmSnapshot();
      const barDurationSec = getBarDurationSec(bpm);
      actions.setPlayback({
        currentTimeSec: audio.currentTime,
        durationSec: audio.duration,
        progress01: Math.max(0, Math.min(1, audio.currentTime / audio.duration)),
      });
      actions.setAnalysis({
        bpm,
        bpmSource,
        barDurationSec,
      });

      // Auto-revibe not only near the end: if we're in a strong transitionable section,
      // request the next track (cueing) and then let the planner decide when to switch.
      const nowMs = Date.now();
      const analysisNow = useMusicPlayerStore.getState().analysis;
      const canAutoRevibe =
        nowMs - autoRevibeAtMsRef.current > AUTO_REVIBE_COOLDOWN_MS &&
        audio.currentTime > AUTO_REVIBE_MIN_PLAY_SEC &&
        !revibeTriggeredRef.current &&
        !waitingForBeatRef.current &&
        !nextTrackReadyRef.current &&
        !crossfadeInProgressRef.current;
      const isGoodMixMoment =
        analysisNow.section === "breakdown" ||
        (analysisNow.section === "culmination" && analysisNow.bassEnergy > 0.55) ||
        (analysisNow.stillDurationMs > 900);
      if (canAutoRevibe && isGoodMixMoment && onRevibeRef.current) {
        autoRevibeAtMsRef.current = nowMs;
        revibeTriggeredRef.current = true;
        await onRevibeRef.current(e);
      }

      // Auto-queue the next track early enough to complete a 16-bar crossfade smoothly.
      // This requests a new track, but does NOT force an immediate transition.
      const crossfadeDurationSec = 16 * barDurationSec;
      const requestLeadSec = Math.max(45, crossfadeDurationSec + 8);
      if (
        audio.duration > 20 &&
        audio.currentTime > virtualDuration - requestLeadSec &&
        !revibeTriggeredRef.current &&
        !waitingForBeatRef.current &&
        !nextTrackReadyRef.current &&
        !crossfadeInProgressRef.current
      ) {
        revibeTriggeredRef.current = true;
        if (onRevibeRef.current) await onRevibeRef.current(e);
      }

      // Transition planner: when a next track is ready, schedule crossfade on a musical boundary.
      if (waitingForBeatRef.current && nextTrackReadyRef.current && !crossfadeInProgressRef.current) {
        const { analysis } = useMusicPlayerStore.getState();
        const section = analysis.section;
        const phraseBars =
          section === "intro" || section === "comeup"
            ? 8
            : section === "breakdown"
              ? 4
              : DEFAULT_PHRASE_BARS;

        // Freeze barDurationSec while we are planning to avoid chasing BPM jitter.
        if (!plannedBarDurationSecRef.current) plannedBarDurationSecRef.current = barDurationSec;
        const plannedBarDurationSec = plannedBarDurationSecRef.current;

        let plannedStartSec = getNextBoundarySec(audio.currentTime, plannedBarDurationSec, phraseBars);

        // If we're too close to the end to fit a full crossfade, fall back to next bar.
        if (audio.duration - plannedStartSec < crossfadeDurationSec + 2) {
          plannedStartSec = getNextBoundarySec(audio.currentTime, plannedBarDurationSec, 1);
        }

        if (lastPlannedStartSecRef.current !== plannedStartSec) {
          lastPlannedStartSecRef.current = plannedStartSec;
          actions.setTransition({
            state: "planned",
            phraseBars,
            plannedStartSec,
            durationSec: crossfadeDurationSec,
            progress01: 0,
          });
        }

        // Start the crossfade on/near the planned boundary, but only when the vibe signal says it's OK.
        const epsilon = 0.25;
        const recentSignalMs = analysis.lastTransitionSignalAtMs
          ? performance.now() - analysis.lastTransitionSignalAtMs
          : Infinity;
        const hasRecentSignal = recentSignalMs < plannedBarDurationSec * 1000 * 2; // within ~2 bars
        if (
          (analysis.transitionSignal || hasRecentSignal || audio.duration - audio.currentTime < 3) &&
          audio.currentTime + epsilon >= plannedStartSec &&
          audio.currentTime <= plannedStartSec + 0.5
        ) {
          lastPlannedStartSecRef.current = null;
          plannedBarDurationSecRef.current = null;
          await crossfadeOnNextBeat();
        }
      } else if (!crossfadeInProgressRef.current) {
        // Clear planner UI when we are not in a planned transition.
        if (useMusicPlayerStore.getState().transition.state !== "none") {
          lastPlannedStartSecRef.current = null;
          plannedBarDurationSecRef.current = null;
          actions.resetTransition();
        }
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
  }, [actions, crossfadeToCuedTrack, getBarDurationSec, getBpmSnapshot, isIOS, onRevibeRef]);

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

