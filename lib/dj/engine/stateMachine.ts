import type {
  DJEvent,
  DJState,
  DeckSnapshot,
} from "./types";
import { DEFAULT_ANALYSIS_SNAPSHOT } from "./types";

type StateOf<T extends DJState["type"]> = Extract<DJState, { type: T }>;

export function getInitialDJState(): DJState {
  return { type: "idle" };
}

function applyAnalysisToDeck(
  deck: DeckSnapshot,
  event: Extract<DJEvent, { type: "TRACK_ANALYSIS_READY" }>,
): DeckSnapshot {
  if (deck.track.id !== event.trackId) return deck;
  if (
    event.analysis.analysisVersion !== undefined &&
    deck.analysisVersion === event.analysis.analysisVersion
  ) return deck;
  return {
    ...deck,
    track: {
      ...deck.track,
      bpm: event.analysis.bpm ?? deck.track.bpm,
      keySignature: event.analysis.keySignature ?? deck.track.keySignature,
      camelotKey: event.analysis.camelotKey ?? deck.track.camelotKey,
    },
    beatGrid: event.analysis.beatGrid ?? deck.beatGrid,
    structureMap: event.analysis.structureMap ?? deck.structureMap,
    energyCurve: event.analysis.energyCurve,
    cuePoints: event.analysis.cuePoints ?? deck.cuePoints,
    analysisVersion: event.analysis.analysisVersion ?? deck.analysisVersion,
    segments: event.analysis.segments ?? deck.segments,
  };
}

function applyTrackAnalysis(
  state: DJState,
  event: Extract<DJEvent, { type: "TRACK_ANALYSIS_READY" }>,
): DJState {
  switch (state.type) {
    case "ready":
    case "playing":
    case "paused": {
      const activeDeck = applyAnalysisToDeck(state.activeDeck, event);
      return activeDeck === state.activeDeck ? state : { ...state, activeDeck };
    }
    case "cueing":
    case "planned": {
      const activeDeck = applyAnalysisToDeck(state.activeDeck, event);
      const cueDeck = applyAnalysisToDeck(state.cueDeck, event);
      if (activeDeck === state.activeDeck && cueDeck === state.cueDeck) return state;
      if (state.type === "planned") return {
        type: "cueing",
        activeDeck,
        cueDeck,
        analysis: state.analysis,
      };
      return {
        ...state,
        activeDeck,
        cueDeck,
      };
    }
    case "crossfading": {
      const outgoingDeck = applyAnalysisToDeck(state.outgoingDeck, event);
      const incomingDeck = applyAnalysisToDeck(state.incomingDeck, event);
      if (outgoingDeck === state.outgoingDeck && incomingDeck === state.incomingDeck) return state;
      return {
        ...state,
        outgoingDeck,
        incomingDeck,
      };
    }
    default:
      return state;
  }
}

function reduceIdle(state: StateOf<"idle">, event: DJEvent): DJState {
  if (event.type !== "LOAD_TRACK") return state;
  return {
    type: "loading",
    trackId: event.trackId,
    deck: event.deck ?? "A",
  };
}

function reduceLoading(state: StateOf<"loading">, event: DJEvent): DJState {
  if (event.type === "TRACK_LOADED") return { type: "ready", activeDeck: event.deck };
  if (event.type === "TRACK_LOAD_FAILED" || event.type === "RESET") return { type: "idle" };
  return state;
}

function reduceReady(state: StateOf<"ready">, event: DJEvent): DJState {
  if (event.type === "PLAY") {
    return {
      type: "playing",
      activeDeck: state.activeDeck,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };
  }
  if (event.type === "LOAD_TRACK") {
    return {
      type: "loading",
      trackId: event.trackId,
      deck: event.deck ?? state.activeDeck.id,
    };
  }
  if (event.type === "RESET") return { type: "idle" };
  return state;
}

function reducePlaying(state: StateOf<"playing">, event: DJEvent): DJState {
  if (event.type === "PAUSE") return { type: "paused", activeDeck: state.activeDeck };
  if (event.type === "CUE_READY") {
    return {
      type: "cueing",
      activeDeck: state.activeDeck,
      cueDeck: event.deck,
      analysis: state.analysis,
    };
  }
  if (event.type === "ANALYSIS_UPDATE") return { ...state, analysis: event.analysis };
  if (event.type === "RESET") return { type: "idle" };
  return state;
}

function reduceCueing(state: StateOf<"cueing">, event: DJEvent): DJState {
  if (event.type === "PAUSE") return { type: "paused", activeDeck: state.activeDeck };
  if (event.type === "PLAN_TRANSITION") {
    return { ...state, type: "planned", plan: event.plan };
  }
  if (event.type === "CANCEL_TRANSITION") {
    return { type: "playing", activeDeck: state.activeDeck, analysis: state.analysis };
  }
  if (event.type === "ANALYSIS_UPDATE") return { ...state, analysis: event.analysis };
  if (event.type === "RESET") return { type: "idle" };
  return state;
}

function reducePlanned(state: StateOf<"planned">, event: DJEvent): DJState {
  if (event.type === "PAUSE") return { type: "paused", activeDeck: state.activeDeck };
  if (event.type === "START_CROSSFADE") {
    return {
      type: "crossfading",
      outgoingDeck: state.activeDeck,
      incomingDeck: state.cueDeck,
      plan: state.plan,
      progress: 0,
    };
  }
  if (event.type === "PLAN_TRANSITION") return { ...state, plan: event.plan };
  if (event.type === "CANCEL_TRANSITION") {
    return { type: "playing", activeDeck: state.activeDeck, analysis: state.analysis };
  }
  if (event.type === "ANALYSIS_UPDATE") return { ...state, analysis: event.analysis };
  if (event.type === "RESET") return { type: "idle" };
  return state;
}

function reduceCrossfading(state: StateOf<"crossfading">, event: DJEvent): DJState {
  if (event.type === "CROSSFADE_TICK") return { ...state, progress: event.progress };
  if (event.type === "CROSSFADE_COMPLETE") {
    return {
      type: "playing",
      activeDeck: state.incomingDeck,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };
  }
  if (event.type === "RESET") return { type: "idle" };
  return state;
}

function reducePaused(state: StateOf<"paused">, event: DJEvent): DJState {
  if (event.type === "PLAY") {
    return {
      type: "playing",
      activeDeck: state.activeDeck,
      analysis: DEFAULT_ANALYSIS_SNAPSHOT,
    };
  }
  if (event.type === "LOAD_TRACK") {
    return {
      type: "loading",
      trackId: event.trackId,
      deck: event.deck ?? state.activeDeck.id,
    };
  }
  if (event.type === "RESET") return { type: "idle" };
  return state;
}

export function djReducer(state: DJState, event: DJEvent): DJState {
  if (event.type === "TRACK_ANALYSIS_READY") return applyTrackAnalysis(state, event);
  switch (state.type) {
    case "idle":
      return reduceIdle(state, event);
    case "loading":
      return reduceLoading(state, event);
    case "ready":
      return reduceReady(state, event);
    case "playing":
      return reducePlaying(state, event);
    case "cueing":
      return reduceCueing(state, event);
    case "planned":
      return reducePlanned(state, event);
    case "crossfading":
      return reduceCrossfading(state, event);
    case "paused":
      return reducePaused(state, event);
  }
}

export function isTrackPlaying(state: DJState): boolean {
  return ["playing", "cueing", "planned", "crossfading"].includes(state.type);
}

export function isTransitionActive(state: DJState): boolean {
  return ["cueing", "planned", "crossfading"].includes(state.type);
}

export function getActiveDeck(state: DJState): DeckSnapshot | null {
  switch (state.type) {
    case "ready":
    case "playing":
    case "cueing":
    case "planned":
    case "paused":
      return state.activeDeck;
    case "crossfading":
      return state.incomingDeck;
    default:
      return null;
  }
}
