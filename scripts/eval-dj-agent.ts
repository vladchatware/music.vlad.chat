import { generateText, hasToolCall, stepCountIs } from "ai";
import { z } from "zod";

import { systemMessage } from "../lib/ai";
import { djTimelinePatchSchema } from "../lib/dj";
import { resolveDJModel } from "../lib/server/djModel";

type Scenario = {
  name: string;
  prompt: string;
  state: Record<string, unknown>;
  candidates: Array<Record<string, unknown> & { id: number }>;
  analyses: Record<number, Record<string, unknown>>;
};

const scenarios: Scenario[] = [
  {
    name: "phrase-preserving blend",
    prompt: "Keep going and preserve the current performance. Take it where it should go next.",
    state: {
      activeTrack: { id: 1, title: "Current", bpm: 124, camelotKey: "8A" },
      currentTimeSec: 132,
      durationSec: 210,
      section: "drop",
      overallEnergy: 0.78,
      playedTrackIds: [1],
      setQueue: { revision: 0, playbackRevision: 0, committed: null, planned: [] },
    },
    candidates: [
      { id: 2, title: "Compatible", bpm: 125, genre: "deep house", duration: 204_000 },
      { id: 3, title: "Reset", bpm: 92, genre: "ambient", duration: 190_000 },
    ],
    analyses: {
      2: { tempo: { bpm: 125, confidence: 0.9 }, tonal: { camelotKey: "8A", confidence: 0.8 }, cuePoints: { mixInSec: 16, mixOutSec: 184 }, sections: ["intro", "drop", "outro"] },
      3: { tempo: { bpm: 92, confidence: 0.8 }, tonal: { camelotKey: "4B", confidence: 0.7 }, cuePoints: { mixInSec: 24, mixOutSec: 168 }, sections: ["intro", "breakdown", "outro"] },
    },
  },
  {
    name: "half-time relationship",
    prompt: "Keep the pressure but make the next move heavier.",
    state: {
      activeTrack: { id: 10, title: "Fast", bpm: 174, camelotKey: "9A" },
      currentTimeSec: 150,
      durationSec: 230,
      section: "buildup",
      overallEnergy: 0.72,
      playedTrackIds: [10],
      setQueue: { revision: 0, playbackRevision: 0, committed: null, planned: [] },
    },
    candidates: [
      { id: 11, title: "Half Time", bpm: 87, genre: "halftime", duration: 220_000 },
      { id: 12, title: "Unrelated", bpm: 128, genre: "disco", duration: 205_000 },
    ],
    analyses: {
      11: { tempo: { bpm: 87, confidence: 0.92 }, tonal: { camelotKey: "9A", confidence: 0.85 }, cuePoints: { mixInSec: 8, mixOutSec: 200 }, sections: ["intro", "buildup", "drop", "outro"] },
      12: { tempo: { bpm: 128, confidence: 0.9 }, tonal: { camelotKey: "2B", confidence: 0.8 }, cuePoints: { mixInSec: 16, mixOutSec: 185 }, sections: ["intro", "verse", "outro"] },
    },
  },
];

const model = resolveDJModel(process.env.DJ_MODEL);
const requestTimeoutMs = Number.parseInt(process.env.DJ_EVAL_TIMEOUT_MS ?? "60000", 10);
const liveDeadlineMs = Number.parseInt(process.env.DJ_LIVE_DEADLINE_MS ?? "15000", 10);
const scenarioFilter = process.env.DJ_EVAL_SCENARIO?.toLowerCase();
const results: Array<Record<string, unknown>> = [];
const playerSchema = djTimelinePatchSchema;

for (const scenario of scenarios.filter(({ name }) =>
  !scenarioFilter || name.toLowerCase().includes(scenarioFilter)
)) {
  const startedAt = performance.now();
  const playerCalls: Array<z.infer<typeof playerSchema>> = [];
  const analysisLookups: number[] = [];
  let stateLookupCount = 0;

  try {
    const result = await generateText({
      model,
      system: systemMessage,
      prompt: scenario.prompt,
      stopWhen: [hasToolCall("player"), stepCountIs(12)],
      abortSignal: AbortSignal.timeout(requestTimeoutMs),
      tools: {
        dj_state: {
          description: "Read live DJ state",
          inputSchema: z.object({}).strict(),
          execute: async () => {
            stateLookupCount += 1;
            return scenario.state;
          },
        },
        likes: {
          description: "Get liked SoundCloud tracks",
          inputSchema: z.object({ limit: z.number().optional() }).strict(),
          execute: async () => scenario.candidates,
        },
        tracks: {
          description: "Search SoundCloud tracks",
          inputSchema: z.object({ q: z.string() }).passthrough(),
          execute: async () => scenario.candidates,
        },
        track_analysis: {
          description: "Read one cached rich track analysis",
          inputSchema: z.object({
            id: z.number().int().positive(),
            aspect: z.enum(["summary", "timing", "structure", "energy", "full"]).default("summary"),
          }).strict(),
          execute: async ({ id }) => {
            analysisLookups.push(id);
            return scenario.analyses[id]
              ? { status: "ready", analysis: scenario.analyses[id] }
              : { status: "not_ready", trackId: String(id) };
          },
        },
        player: {
          description: "Replace editable set queue with one to three chosen tracks and declarative DJ performance plans",
          inputSchema: playerSchema,
          execute: async (input) => {
            playerCalls.push(input);
            return { accepted: true };
          },
        },
      },
    });

    const selected = playerCalls[0];
    const selectedHead = selected?.tracks[0];
    const uniqueAnalysisLookups = new Set(analysisLookups);
    const selectedAnalysisInspected = selected
      ? selected.tracks.some((track) => uniqueAnalysisLookups.has(track.id))
      : false;
    const directiveValid = selected ? playerSchema.safeParse(selected).success : false;
    const researchQualityScore =
      (stateLookupCount > 0 ? 1 : 0) * 0.4 +
      (uniqueAnalysisLookups.size > 0 ? 1 : 0) * 0.3 +
      (selectedAnalysisInspected ? 1 : 0) * 0.3;
    const elapsedMs = Math.round(performance.now() - startedAt);
    results.push({
      scenario: scenario.name,
      ok:
        playerCalls.length === 1 &&
        selected?.tracks.every((track) =>
          scenario.candidates.some((candidate) => candidate.id === track.id)
        ) &&
        directiveValid &&
        stateLookupCount > 0,
      selectedTrackId: selectedHead?.id ?? null,
      selectedTrackIds: selected?.tracks.map((track) => track.id) ?? [],
      playerCallCount: playerCalls.length,
      analysisLookups,
      stateLookupCount,
      uniqueAnalysisLookupCount: uniqueAnalysisLookups.size,
      duplicateAnalysisLookupCount: analysisLookups.length - uniqueAnalysisLookups.size,
      selectedAnalysisInspected,
      directiveValid,
      researchQualityScore,
      steps: result.steps.length,
      withinLiveDeadline: elapsedMs <= liveDeadlineMs,
      elapsedMs,
    });
  } catch (error) {
    results.push({
      scenario: scenario.name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }
}

const passed = results.filter((result) => result.ok === true).length;
const withinLiveDeadline = results.filter((result) => result.withinLiveDeadline === true).length;
console.log(JSON.stringify({ model, requestTimeoutMs, liveDeadlineMs, passed, withinLiveDeadline, total: results.length, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
