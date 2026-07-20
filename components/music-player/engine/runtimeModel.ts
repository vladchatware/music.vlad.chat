import {
  constructBeatGridFromBpm,
  compilePerformancePlan,
  createTransitionPlan,
  djReducer,
  getInitialDJState,
  type AnalysisSnapshot,
  type BeatGrid,
  type DeckAnalysisMetadata,
  type DeckSnapshot,
  type DJEvent,
  type DJState,
  type DJTrack,
  type DJPerformancePlan,
  type EnergyCurve,
  type TransitionPlan,
  type PerformanceCompilationDiagnostics,
  type PerformanceSegment,
} from "@/lib/dj";
import {
  toEnergyCurve,
  toStructureMap,
  type TrackAnalysis,
} from "@/lib/trackAnalysis";
import type { TrackSection } from "../store/useMusicPlayerStore";
import type { SoundCloudTrack } from "../types";
import { createStore, type StoreApi } from "zustand/vanilla";

export type TransitionOutcome = "completed" | "aborted" | "failed_start";

export type DeckId = "A" | "B";

export type DeckStatus = {
  canPlay: boolean;
  metadataLoaded: boolean;
  isPlaying: boolean;
  lastError: string | null;
};

export type HoldLoopCache = {
  durationSec: number;
  loopStartSec: number;
  windowSec: number;
  barDurationSec: number | null;
  bars: number | null;
  bpm: number | null;
};

export interface UseDJEngineOptions {
  isIOS: boolean;
  onRequestNextTrack?: () => Promise<void>;
  autoCueConfig?: {
    minPlaySec?: number;
    minProgress?: number;
    minRemainingSec?: number;
    shortTrackMinHoldSec?: number;
    shortTrackMinProgress?: number;
    shortTrackMinRemainingSec?: number;
  };
}

export interface DJEngineState {
  djState: DJState;
}

export type TransitionMetric = {
  handoffEnergyMismatch: number;
  isAbruptTransition: boolean;
  transitionOutcome: TransitionOutcome;
  atMs: number;
};

export type EngineDiagnostics = {
  transitionStartFailures: number;
  transitionAborts: number;
  plannedTimeoutReplans: number;
  earlyCutoffsCount: number;
  totalTransitions: number;
  abruptTransitions: number;
  transitionMetrics: TransitionMetric[];
  uninterruptedSegmentsSec: number[];
  currentSegmentStartMs: number | null;
};

export function djEngineReducer(state: DJEngineState, action: DJEvent): DJEngineState {
  const djState = djReducer(state.djState, action);
  return djState === state.djState ? state : { ...state, djState };
}

export type DJEngineStore = StoreApi<DJEngineState>;

export function createDJEngineStore(): DJEngineStore {
  return createStore<DJEngineState>(() => ({
    djState: getInitialDJState(),
  }));
}

export function soundCloudToDJTrack(track: SoundCloudTrack | null): DJTrack | null {
  if (!track) return null;
  const durationMs = track.duration;
  return {
    id: track.id,
    title: track.title,
    artist: track.user?.username || track.user?.full_name,
    genre: track.genre,
    bpm: track.bpm,
    keySignature: track.key_signature,
    artworkUrl: track.artwork_url,
    duration:
      Number.isFinite(durationMs) && durationMs > 0
        ? durationMs / 1000
        : undefined,
  };
}

export function createDeckSnapshot(
  id: DeckId,
  track: DJTrack,
  positionSec: number,
  beatGrid: BeatGrid | null,
  energyCurve: EnergyCurve | null,
): DeckSnapshot {
  return {
    id,
    track,
    positionSec,
    beatGrid: beatGrid ?? constructBeatGridFromBpm(track.bpm),
    structureMap: null,
    energyCurve,
  };
}

export function buildInitialDeckSnapshot(track: DJTrack): DeckSnapshot {
  return createDeckSnapshot(
    "A",
    track,
    0,
    constructBeatGridFromBpm(track.bpm),
    null,
  );
}

export function getAnalysisTrackIds(state: DJState): [number | null, number | null] {
  switch (state.type) {
    case "loading":
      return [state.trackId, null];
    case "ready":
    case "playing":
    case "paused":
      return [state.activeDeck.track.id, null];
    case "cueing":
    case "planned":
      return [state.activeDeck.track.id, state.cueDeck.track.id];
    case "crossfading":
      return [state.outgoingDeck.track.id, state.incomingDeck.track.id];
    default:
      return [null, null];
  }
}

export function toDeckAnalysisMetadata(analysis: TrackAnalysis): DeckAnalysisMetadata {
  const tempoReliable = analysis.tempo.confidence >= 0.25;
  const tonalReliable = analysis.tonal.confidence >= 0.25;
  return {
    analysisVersion: analysis.analysisVersion,
    bpm: tempoReliable ? analysis.tempo.bpm : undefined,
    beatGrid: tempoReliable
      ? {
          bpm: analysis.tempo.bpm,
          beatsPerBar: 4,
          firstDownbeat: analysis.tempo.firstDownbeatSec,
          beats: analysis.tempo.beatsSec,
          confidence: analysis.tempo.confidence,
        }
      : undefined,
    structureMap: tempoReliable ? toStructureMap(analysis) : undefined,
    energyCurve: toEnergyCurve(analysis),
    cuePoints: tempoReliable ? analysis.cuePoints : undefined,
    keySignature: tonalReliable
      ? `${analysis.tonal.key}${analysis.tonal.scale.toLowerCase().startsWith("minor") ? "m" : ""}`
      : undefined,
    camelotKey: tonalReliable ? analysis.tonal.camelotKey : undefined,
    segments: analysis.segments,
  };
}

export function getSegmentRuntimeContext(
  segments: ReadonlyArray<Pick<PerformanceSegment, "id" | "startSec" | "endSec" | "section" | "energy" | "energySlope">>,
  playheadSec: number,
) {
  const currentIndex = Math.max(0, segments.findIndex((segment) =>
    playheadSec >= segment.startSec && playheadSec < segment.endSec
  ));
  const current = segments[currentIndex] ?? null;
  const upcoming = current ? segments.slice(currentIndex + 1, currentIndex + 4) : [];
  const describe = (segment: typeof current) => {
    if (!segment) return "";
    const slope = segment.energySlope > 0.004 ? "rising"
      : segment.energySlope < -0.004 ? "falling"
        : "steady";
    return `${segment.section} ${segment.energy.toFixed(2)} ${slope}`;
  };
  return {
    current,
    upcoming,
    nextBoundaryInSec: current ? Math.max(0, current.endSec - playheadSec) : null,
    trajectory: [current, ...upcoming].filter(Boolean).map(describe).join(" → "),
  };
}

export function getFiniteDurationSec(value: number | null | undefined): number | null {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : null;
}

export function withEffectiveTrackDuration(
  track: DJTrack,
  mediaDurationSec: number | null,
): DJTrack {
  if (mediaDurationSec === null) return track;
  const metadataDurationSec = getFiniteDurationSec(track.duration);
  if (metadataDurationSec !== null && Math.abs(metadataDurationSec - mediaDurationSec) < 1) {
    return track;
  }
  return {
    ...track,
    duration: mediaDurationSec,
  };
}

export function clampTransitionPlanToMedia(opts: {
  plan: TransitionPlan;
  currentTimeSec: number;
  outgoingDurationSec: number | null;
  incomingDurationSec: number | null;
}): TransitionPlan {
  const { plan, currentTimeSec, outgoingDurationSec, incomingDurationSec } = opts;
  const maxByIncoming =
    incomingDurationSec !== null
      ? Math.max(0.1, incomingDurationSec - 0.1)
      : Number.POSITIVE_INFINITY;

  const isShortTrack = outgoingDurationSec !== null && outgoingDurationSec <= 70;
  const outgoingRatio = isShortTrack ? 0.3 : 0.35;
  const maxByOutgoing =
    outgoingDurationSec !== null
      ? Math.max(0.1, outgoingDurationSec * outgoingRatio)
      : Number.POSITIVE_INFINITY;

  const clampedCrossfadeDurationSec = Math.min(
    Math.max(0.1, plan.crossfadeDurationSec),
    32,
    maxByIncoming,
    maxByOutgoing,
  );

  const latestStartBoundarySec =
    outgoingDurationSec !== null
      ? Math.max(currentTimeSec, outgoingDurationSec - 0.25)
      : Number.POSITIVE_INFINITY;
  const clampedStartBoundarySec = Math.min(
    plan.startBoundary.timeSec,
    latestStartBoundarySec,
  );

  if (
    clampedCrossfadeDurationSec === plan.crossfadeDurationSec &&
    clampedStartBoundarySec === plan.startBoundary.timeSec
  ) {
    return plan;
  }

  return {
    ...plan,
    crossfadeDurationSec: clampedCrossfadeDurationSec,
    startBoundary: {
      ...plan.startBoundary,
      timeSec: clampedStartBoundarySec,
    },
    eqCurve: {
      ...plan.eqCurve,
      durationSec: clampedCrossfadeDurationSec,
    },
  };
}

export function resolveTransitionPlan(opts: {
  outgoingDeck: DeckSnapshot;
  incomingDeck: DeckSnapshot;
  analysis: AnalysisSnapshot;
  currentTimeSec: number;
  outgoingDurationSec: number | null;
  incomingDurationSec: number | null;
  performanceIntent: { trackId: number; plan: DJPerformancePlan } | null;
}): {
  plan: TransitionPlan;
  rawPlan: TransitionPlan;
  diagnostics: PerformanceCompilationDiagnostics | null;
} {
  const compiled =
    opts.performanceIntent?.trackId === opts.incomingDeck.track.id
      ? compilePerformancePlan(opts.performanceIntent.plan, {
          outgoingDeck: opts.outgoingDeck,
          incomingDeck: opts.incomingDeck,
          currentTimeSec: opts.currentTimeSec,
        })
      : null;
  const rawPlan =
    compiled?.plan ??
    createTransitionPlan({
      outgoingDeck: opts.outgoingDeck,
      incomingDeck: opts.incomingDeck,
      currentTimeSec: opts.currentTimeSec,
      analysis: opts.analysis,
    });
  return {
    rawPlan,
    plan: clampTransitionPlanToMedia({
      plan: rawPlan,
      currentTimeSec: opts.currentTimeSec,
      outgoingDurationSec: opts.outgoingDurationSec,
      incomingDurationSec: opts.incomingDurationSec,
    }),
    diagnostics: compiled?.diagnostics ?? null,
  };
}

export function sectionToAnalysis(
  section: TrackSection,
  bpm: number | null,
  bassEnergy: number,
  overallEnergy: number,
  stillDurationMs: number,
  dropDetected: boolean,
  beatPhase: number,
  timeToNextBeatMs: number,
): AnalysisSnapshot {
  const phraseSection: AnalysisSnapshot["section"] =
    section === "comeup"
      ? "buildup"
      : section === "culmination"
        ? "drop"
        : section;
  return {
    bpm,
    bpmSource: bpm ? "detected" : "fallback",
    section: phraseSection,
    overallEnergy,
    bassEnergy,
    stillDurationMs,
    dropDetected,
    beatPhase,
    timeToNextBeatMs,
  };
}
