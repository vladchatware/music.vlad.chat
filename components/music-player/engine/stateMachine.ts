"use client";

export type EnginePhase =
  | "needsGesture"
  | "paused"
  | "playing"
  | "cueingNext"
  | "crossfading";

export type EngineState = {
  phase: EnginePhase;
  loading: boolean;
};

export type EngineAction =
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "PLAYING" }
  | { type: "PAUSED" }
  | { type: "NEEDS_GESTURE" }
  | { type: "CUEING_START" }
  | { type: "CUE_READY" }
  | { type: "CROSSFADE_START" }
  | { type: "CROSSFADE_END" };

export const initialEngineState: EngineState = {
  phase: "needsGesture",
  loading: false,
};

export function engineReducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "NEEDS_GESTURE":
      return { ...state, phase: "needsGesture" };
    case "PLAYING":
      return { ...state, phase: "playing" };
    case "PAUSED":
      return { ...state, phase: "paused" };
    case "CUEING_START":
      return { ...state, phase: "cueingNext" };
    case "CUE_READY":
      // Still playing the active deck; this just indicates a queued next track exists.
      return state.phase === "playing" ? state : { ...state, phase: "playing" };
    case "CROSSFADE_START":
      return { ...state, phase: "crossfading" };
    case "CROSSFADE_END":
      return { ...state, phase: "playing" };
    default:
      return state;
  }
}

