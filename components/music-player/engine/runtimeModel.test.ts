import { describe, expect, it } from "vitest";

import {
  clampTransitionPlanToMedia,
  buildInitialDeckSnapshot,
  createDJEngineStore,
  djEngineReducer,
  getAnalysisTrackIds,
  isLikelyPreviewStream,
  getSegmentRuntimeContext,
  sectionToAnalysis,
  soundCloudToDJTrack,
  toDeckAnalysisMetadata,
} from "./runtimeModel";
import type { DJState, TransitionPlan } from "@/lib/dj";
import type { TrackAnalysis } from "@/lib/trackAnalysis";

const plan: TransitionPlan = {
  startBoundary: { timeSec: 190, barIndex: 95, isPhraseBoundary: true },
  crossfadeDurationSec: 60,
  tempoAdjustment: { targetPlaybackRate: 1, phaseOffsetMs: 0, confidence: 1, feasible: true },
  eqCurve: { durationSec: 60, outgoing: [], incoming: [] },
  harmonicScore: { compatibility: 1, relationship: "same", suggestedPitchShift: 0, recommended: true },
  energyScore: { energyMatch: 1, momentumMatch: 1, contrastScore: 0.5, overall: 1 },
  quality: 1,
  createdAt: 0,
};

describe("runtimeModel", () => {
  it("follows playhead through current and upcoming segments", () => {
    const context = getSegmentRuntimeContext([
      { id: "s0", startSec: 0, endSec: 32, section: "intro", energy: 0.2, energySlope: 0.01 },
      { id: "s1", startSec: 32, endSec: 64, section: "buildup", energy: 0.5, energySlope: 0.02 },
      { id: "s2", startSec: 64, endSec: 96, section: "drop", energy: 0.9, energySlope: 0 },
    ], 54);

    expect(context.current).toMatchObject({ id: "s1", section: "buildup" });
    expect(context.upcoming.map((segment) => segment.id)).toEqual(["s2"]);
    expect(context.nextBoundaryInSec).toBe(10);
    expect(context.trajectory).toBe("buildup 0.50 rising → drop 0.90 steady");
  });

  it("prepares initial deck from track metadata without browser canplay", () => {
    expect(buildInitialDeckSnapshot({
      id: 42,
      title: "Initial",
      bpm: 120,
      duration: 180,
    })).toMatchObject({
      id: "A",
      positionSec: 0,
      track: { id: 42, duration: 180 },
      beatGrid: { bpm: 120 },
    });
  });

  it("publishes reducer state through Zustand", () => {
    const store = createDJEngineStore();
    const states: string[] = [];
    const unsubscribe = store.subscribe((state) => states.push(state.djState.type));

    store.setState((state) =>
      djEngineReducer(state, { type: "LOAD_TRACK", trackId: 42, deck: "A" }),
    );

    expect(store.getState().djState.type).toBe("loading");
    expect(states).toEqual(["loading"]);
    unsubscribe();
  });

  it("normalizes SoundCloud metadata for engine use", () => {
    expect(soundCloudToDJTrack({
      id: 42,
      title: "Track",
      duration: 180_000,
      bpm: 124,
      user: { username: "Artist" },
    })).toMatchObject({ id: 42, title: "Track", artist: "Artist", duration: 180, bpm: 124 });
  });

  it("rejects a short media preview masquerading as a full track", () => {
    expect(
      isLikelyPreviewStream({
        metadataDurationSec: 428.042,
        mediaDurationSec: 29.779,
      }),
    ).toBe(true);
    expect(
      isLikelyPreviewStream({
        metadataDurationSec: 104,
        mediaDurationSec: 103.9,
      }),
    ).toBe(false);
  });

  it("derives active analysis IDs from state", () => {
    const state: DJState = {
      type: "cueing",
      activeDeck: { id: "A", track: { id: 1 }, positionSec: 0, beatGrid: null, structureMap: null, energyCurve: null },
      cueDeck: { id: "B", track: { id: 2 }, positionSec: 0, beatGrid: null, structureMap: null, energyCurve: null },
      analysis: {
        bpm: null, bpmSource: "fallback", section: "unknown", overallEnergy: 0,
        bassEnergy: 0, stillDurationMs: 0, dropDetected: false, beatPhase: 0, timeToNextBeatMs: 0,
      },
    };
    expect(getAnalysisTrackIds(state)).toEqual([1, 2]);
  });

  it("drops unreliable tonal and tempo metadata while preserving energy", () => {
    const analysis = {
      source: "soundcloud", sourceTrackId: "1", analysisVersion: "v1", durationSec: 180,
      processingTimeMs: 1, warnings: [],
      tempo: { bpm: 124, confidence: 0.1, beatsSec: [], firstDownbeatSec: 0, downbeatsSec: [], downbeatConfidence: 0.1 },
      tonal: { key: "A", scale: "minor", camelotKey: "8A", confidence: 0.1 },
      energy: { sampleRate: 1, samples: [0.5], peaks: [], valleys: [] },
      structure: { phrases: [], downbeats: [], sections: [] },
      cuePoints: { mixInSec: 8, mixOutSec: 160, confidence: 0.8, reason: "fixture" },
      segments: [{
        id: "s0", startSec: 0, endSec: 16, startBeat: 0, endBeat: 32,
        section: "intro", energy: 0.2, energySlope: 0, rhythmicDensity: 0.3,
        entryQuality: 0.8, exitQuality: 0.4, confidence: 0.7,
        valence: 0.6, arousal: 0.2,
        vocalProbability: 0.15, danceability: null, approachability: null, engagement: null,
        mirexMood: { wistful: 0.8 }, themes: null, instruments: null, genres: null, timbre: null,
      }],
    } satisfies TrackAnalysis;
    const metadata = toDeckAnalysisMetadata(analysis);
    expect(metadata.bpm).toBeUndefined();
    expect(metadata.camelotKey).toBeUndefined();
    expect(metadata.cuePoints).toBeUndefined();
    expect(metadata.energyCurve.samples[0]).toBe(0.5);
    expect(metadata.segments?.[0]).toMatchObject({ mirexMood: { wistful: 0.8 }, vocalProbability: 0.15 });
  });

  it("clamps transition duration and boundary to media", () => {
    const clamped = clampTransitionPlanToMedia({
      plan,
      currentTimeSec: 100,
      outgoingDurationSec: 180,
      incomingDurationSec: 20,
    });
    expect(clamped.crossfadeDurationSec).toBeLessThanOrEqual(19.9);
    expect(clamped.startBoundary.timeSec).toBeLessThanOrEqual(179.75);
    expect(clamped.eqCurve.durationSec).toBe(clamped.crossfadeDurationSec);
  });

  it("maps live UI sections into musical phrase types", () => {
    expect(sectionToAnalysis("comeup", null, 0, 0, 0, false, 0, 0).section).toBe("buildup");
    expect(sectionToAnalysis("culmination", null, 0, 0, 0, false, 0, 0).section).toBe("drop");
  });
});
