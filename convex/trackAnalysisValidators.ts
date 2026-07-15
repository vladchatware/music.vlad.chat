import { v } from "convex/values";

export const phraseTypeValidator = v.union(
  v.literal("intro"),
  v.literal("verse"),
  v.literal("buildup"),
  v.literal("drop"),
  v.literal("breakdown"),
  v.literal("outro"),
  v.literal("unknown"),
);

export const phraseValidator = v.object({
  startBeat: v.number(),
  lengthBars: v.number(),
  type: phraseTypeValidator,
  energy: v.number(),
  startTime: v.number(),
  endTime: v.number(),
});

export const sectionValidator = v.object({
  type: phraseTypeValidator,
  phrases: v.array(phraseValidator),
  startTime: v.number(),
  endTime: v.number(),
  energy: v.number(),
});

export const analysisSegmentValidator = v.object({
  id: v.string(),
  startSec: v.number(),
  endSec: v.number(),
  startBeat: v.number(),
  endBeat: v.number(),
  section: phraseTypeValidator,
  energy: v.number(),
  energySlope: v.number(),
  rhythmicDensity: v.number(),
  entryQuality: v.number(),
  exitQuality: v.number(),
  confidence: v.number(),
  // Storage-only until existing v6 documents are rewritten; queries strip it.
  mood: v.optional(v.union(v.record(v.string(), v.number()), v.null())),
  valence: v.union(v.number(), v.null()),
  arousal: v.union(v.number(), v.null()),
  vocalProbability: v.union(v.number(), v.null()),
  danceability: v.union(v.number(), v.null()),
  approachability: v.union(v.number(), v.null()),
  engagement: v.union(v.number(), v.null()),
  mirexMood: v.union(v.record(v.string(), v.number()), v.null()),
  themes: v.union(v.record(v.string(), v.number()), v.null()),
  instruments: v.union(v.record(v.string(), v.number()), v.null()),
  genres: v.union(v.record(v.string(), v.number()), v.null()),
  timbre: v.union(v.record(v.string(), v.number()), v.null()),
});

export const trackAnalysisResultValidator = v.object({
  source: v.literal("soundcloud"),
  sourceTrackId: v.string(),
  analysisVersion: v.string(),
  durationSec: v.number(),
  processingTimeMs: v.number(),
  warnings: v.array(v.string()),
  semantic: v.optional(v.object({
    status: v.union(v.literal("ready"), v.literal("unavailable")),
    models: v.array(v.string()),
    sampleRate: v.number(),
    windowSec: v.number(),
    hopSec: v.number(),
  })),
  tempo: v.object({
    bpm: v.number(),
    confidence: v.number(),
    beatsSec: v.array(v.number()),
    firstDownbeatSec: v.number(),
    downbeatsSec: v.array(v.number()),
    downbeatConfidence: v.number(),
  }),
  tonal: v.object({
    key: v.string(),
    scale: v.string(),
    camelotKey: v.optional(v.string()),
    confidence: v.number(),
  }),
  energy: v.object({
    sampleRate: v.number(),
    samples: v.array(v.number()),
    peaks: v.array(v.number()),
    valleys: v.array(v.number()),
  }),
  structure: v.object({
    phrases: v.array(phraseValidator),
    downbeats: v.array(v.number()),
    sections: v.array(sectionValidator),
  }),
  // Optional only for stored v1/v2 rows. Current worker results must include it;
  // the completion mutation enforces that invariant.
  segments: v.optional(v.array(analysisSegmentValidator)),
  cuePoints: v.object({
    mixInSec: v.number(),
    mixOutSec: v.number(),
    confidence: v.number(),
    reason: v.string(),
  }),
});
