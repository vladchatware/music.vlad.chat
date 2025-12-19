import { create } from "zustand";
import * as THREE from "three";

import { engineReducer, initialEngineState, type EngineAction } from "../engine/stateMachine";
import type { SoundCloudTrack } from "../types";

export type TrackSection = "unknown" | "intro" | "comeup" | "culmination" | "breakdown";
export type BpmSource = "metadata" | "detector" | "fallback";
export type TransitionState = "none" | "planned" | "crossfading";

export type MusicPlayerStore = {
  // Engine UI state
  phase: typeof initialEngineState.phase;
  loading: boolean;

  // Internal singleton lifecycle tracking (to avoid StrictMode double-invoke resets).
  _mountCount: number;
  _resetTimeoutId: ReturnType<typeof setTimeout> | null;

  // Track UI state
  trackA: SoundCloudTrack | null;
  trackB: SoundCloudTrack | null;
  activeTrack: SoundCloudTrack | null;

  // Lightweight analysis snapshot (updated frequently)
  analysis: {
    bpm: number | null;
    bpmSource: BpmSource;
    barDurationSec: number | null;
    section: TrackSection;
    overallEnergy: number;
    bassEnergy: number;
    stillDurationMs: number;
    dropDetected: boolean;
    transitionSignal: boolean;
    transitionSignalReason: "drop" | "highEnergy" | "still" | "trackEndedWhileCueing" | "none";
    lastTransitionSignalAtMs: number | null;
  };

  // Playback snapshot for visualization + planning
  playback: {
    currentTimeSec: number;
    durationSec: number;
    progress01: number;
  };

  // Transition planner state (for ring + scheduling/debug)
  transition: {
    state: TransitionState;
    phraseBars: number; // 16 default, may vary by section
    plannedStartSec: number | null;
    durationSec: number | null;
    progress01: number; // 0..1 (during crossfade)
  };

  // Palette for visualization
  palette: THREE.Color[];

  actions: {
    dispatchEngine: (action: EngineAction) => void;
    setTrackA: (track: SoundCloudTrack | null) => void;
    setTrackB: (track: SoundCloudTrack | null) => void;
    setActiveTrack: (track: SoundCloudTrack | null) => void;
    setAnalysis: (patch: Partial<MusicPlayerStore["analysis"]>) => void;
    setPlayback: (patch: Partial<MusicPlayerStore["playback"]>) => void;
    setTransition: (patch: Partial<MusicPlayerStore["transition"]>) => void;
    setPalette: (colors: THREE.Color[]) => void;
    resetTransition: () => void;
    acquire: () => void;
    release: () => void;
    reset: () => void;
  };
};

export const useMusicPlayerStore = create<MusicPlayerStore>()((set, get) => ({
  ...initialEngineState,

  _mountCount: 0,
  _resetTimeoutId: null,

  trackA: null,
  trackB: null,
  activeTrack: null,

  analysis: {
    bpm: null,
    bpmSource: "fallback",
    barDurationSec: null,
    section: "unknown",
    overallEnergy: 0,
    bassEnergy: 0,
    stillDurationMs: 0,
    dropDetected: false,
    transitionSignal: false,
    transitionSignalReason: "none",
    lastTransitionSignalAtMs: null,
  },

  playback: {
    currentTimeSec: 0,
    durationSec: 0,
    progress01: 0,
  },

  transition: {
    state: "none",
    phraseBars: 16,
    plannedStartSec: null,
    durationSec: null,
    progress01: 0,
  },

  palette: [
    new THREE.Color("#8B1A1A"),
    new THREE.Color("#FF4500"),
    new THREE.Color("#FF8C00"),
    new THREE.Color("#FFD700"),
  ],

  actions: {
    dispatchEngine: (action) =>
      set((state) => {
        const nextEngine = engineReducer({ phase: state.phase, loading: state.loading }, action);
        return nextEngine;
      }),

    setTrackA: (track) => set({ trackA: track }),
    setTrackB: (track) => set({ trackB: track }),
    setActiveTrack: (track) => set({ activeTrack: track }),

    setAnalysis: (patch) =>
      set((state) => ({
        analysis: { ...state.analysis, ...patch },
      })),

    setPlayback: (patch) =>
      set((state) => ({
        playback: { ...state.playback, ...patch },
      })),

    setTransition: (patch) =>
      set((state) => ({
        transition: { ...state.transition, ...patch },
      })),

    setPalette: (colors) => set({ palette: colors }),

    resetTransition: () =>
      set(() => ({
        transition: {
          state: "none",
          phraseBars: 16,
          plannedStartSec: null,
          durationSec: null,
          progress01: 0,
        },
      })),

    acquire: () => {
      const timeoutId = get()._resetTimeoutId;
      if (timeoutId) clearTimeout(timeoutId);
      set((state) => ({
        _mountCount: state._mountCount + 1,
        _resetTimeoutId: null,
      }));
    },

    release: () => {
      set((state) => {
        const nextCount = Math.max(0, state._mountCount - 1);
        if (nextCount !== 0) return { _mountCount: nextCount };

        // Delay reset to avoid wiping state during React StrictMode's
        // mount -> cleanup -> mount sequence in dev.
        const timeoutId = setTimeout(() => {
          get().actions.reset();
        }, 0);

        return { _mountCount: 0, _resetTimeoutId: timeoutId };
      });
    },

    reset: () =>
      set((state) => {
        if (state._resetTimeoutId) clearTimeout(state._resetTimeoutId);
        return {
          ...initialEngineState,
          _mountCount: 0,
          _resetTimeoutId: null,
          trackA: null,
          trackB: null,
          activeTrack: null,
          palette: [
            new THREE.Color("#8B1A1A"),
            new THREE.Color("#FF4500"),
            new THREE.Color("#FF8C00"),
            new THREE.Color("#FFD700"),
          ],
          analysis: {
            bpm: null,
            bpmSource: "fallback",
            barDurationSec: null,
            section: "unknown",
            overallEnergy: 0,
            bassEnergy: 0,
            stillDurationMs: 0,
            dropDetected: false,
            transitionSignal: false,
            transitionSignalReason: "none",
            lastTransitionSignalAtMs: null,
          },
          playback: {
            currentTimeSec: 0,
            durationSec: 0,
            progress01: 0,
          },
          transition: {
            state: "none",
            phraseBars: 16,
            plannedStartSec: null,
            durationSec: null,
            progress01: 0,
          },
        };
      }),
  },
}));

