import { create } from "zustand";
import * as THREE from "three";

import type { SoundCloudTrack } from "../types";

export type TrackSection = "unknown" | "intro" | "comeup" | "culmination" | "breakdown";
export type BpmSource = "metadata" | "detector" | "fallback";
export type TransitionState = "none" | "planned" | "crossfading";

export type MusicPlayerStore = {
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

const DEFAULT_PALETTE_HEX = ["#8B1A1A", "#FF4500", "#FF8C00", "#FFD700"] as const;

function createDefaultPalette(): THREE.Color[] {
  return DEFAULT_PALETTE_HEX.map((hex) => new THREE.Color(hex));
}

function normalizePalette(colors: THREE.Color[]): THREE.Color[] {
  const fallback = createDefaultPalette();
  const normalized = colors
    .filter((color): color is THREE.Color => color instanceof THREE.Color)
    .slice(0, fallback.length);

  while (normalized.length < fallback.length) {
    normalized.push(fallback[normalized.length].clone());
  }

  return normalized;
}

export const useMusicPlayerStore = create<MusicPlayerStore>()((set, get) => ({
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

  palette: createDefaultPalette(),

  actions: {
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

    setPalette: (colors) =>
      set(() => ({
        palette: normalizePalette(colors),
      })),

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
          _mountCount: 0,
          _resetTimeoutId: null,
          trackA: null,
          trackB: null,
          activeTrack: null,
          palette: createDefaultPalette(),
          analysis: {
            bpm: null,
            bpmSource: "fallback",
            barDurationSec: null,
            section: "unknown",
            overallEnergy: 0,
            bassEnergy: 0,
            stillDurationMs: 0,
            dropDetected: false,
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
