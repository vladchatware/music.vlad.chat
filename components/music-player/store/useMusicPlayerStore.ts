import { create } from "zustand";

import { engineReducer, initialEngineState, type EngineAction } from "../engine/stateMachine";
import type { SoundCloudTrack } from "../types";

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

  actions: {
    dispatchEngine: (action: EngineAction) => void;
    setTrackA: (track: SoundCloudTrack | null) => void;
    setTrackB: (track: SoundCloudTrack | null) => void;
    setActiveTrack: (track: SoundCloudTrack | null) => void;
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

  actions: {
    dispatchEngine: (action) =>
      set((state) => {
        const nextEngine = engineReducer({ phase: state.phase, loading: state.loading }, action);
        return nextEngine;
      }),

    setTrackA: (track) => set({ trackA: track }),
    setTrackB: (track) => set({ trackB: track }),
    setActiveTrack: (track) => set({ activeTrack: track }),

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
        };
      }),
  },
}));

