import { ToolLoopAgent, hasToolCall, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";

import { systemMessage } from "../lib/ai";
import { djTimelinePatchSchema, type DJTimelinePatch } from "../lib/dj";
import {
  computeAgentSessionDeadlineAtMs,
  createContinuityIntentController,
} from "../components/music-player/chat/continuityIntent";
import { REVIBE_PROMPT } from "../components/music-player/chat/prompt";
import {
  createDJAgentStepPolicy,
  getDJAgentMode,
} from "../lib/server/djAgentPolicy";
import {
  DJ_PLAYER_DECISION_DEADLINE_MS,
  getDJAgentToolChoice,
  hasUsablePostPlayerAnalysis,
  MAX_DJ_AGENT_STEPS,
} from "../lib/server/agentSessionLimit";
import { resolveDJModel } from "../lib/server/djModel";
import { createBoundedAnalysisSchedule } from "../lib/server/djAgentTools";
import { getDJLiveStateInstruction } from "../lib/server/djLiveState";
import { createDJToolCallBudget } from "../lib/server/djToolCallBudget";

const model = resolveDJModel(process.env.DJ_MODEL);
const requestTimeoutMs = Number.parseInt(
  process.env.DJ_EVAL_TIMEOUT_MS ?? "55000",
  10,
);
const rejectFirstPlayer = process.env.DJ_EVAL_REJECT_FIRST_PLAYER === "true";

let nowMs = 0;
const clock = {
  now: () => nowMs,
  advance: (milliseconds: number) => {
    nowMs += milliseconds;
  },
};

const controller = createContinuityIntentController({
  generateId: () => "mock-live-performance-1",
  now: clock.now,
});
const wallStartedAtMs = performance.now();
const wallElapsedMs = () => performance.now() - wallStartedAtMs;

const activeTrack = {
  id: 100,
  title: "Current Track",
  artist: "Current Artist",
  bpm: 124,
  camelotKey: "8A",
};
const candidates = [
  { id: 201, title: "Aqua Memory", user: { username: "Glass Current" }, bpm: 125, genre: "ambient house" },
  { id: 202, title: "Soft Terminal", user: { username: "Blue System" }, bpm: 123, genre: "deep house" },
  { id: 203, title: "Rainforest UI", user: { username: "Clear Habitat" }, bpm: 126, genre: "progressive house" },
];
const analyses = new Map<number, Record<string, unknown>>([
  [201, { tempo: { bpm: 125, confidence: 0.94 }, tonal: { camelotKey: "8A", confidence: 0.9 }, cuePoints: { mixInSec: 16, mixOutSec: 188 }, segments: [{ label: "intro", startSec: 0, endSec: 32, energy: 0.38 }, { label: "drop", startSec: 64, endSec: 128, energy: 0.76 }, { label: "outro", startSec: 176, endSec: 208, energy: 0.34 }] }],
  [202, { tempo: { bpm: 123, confidence: 0.91 }, tonal: { camelotKey: "9A", confidence: 0.84 }, cuePoints: { mixInSec: 8, mixOutSec: 184 }, segments: [{ label: "intro", startSec: 0, endSec: 24, energy: 0.42 }, { label: "drop", startSec: 72, endSec: 136, energy: 0.7 }, { label: "outro", startSec: 176, endSec: 204, energy: 0.3 }] }],
  [203, { tempo: { bpm: 126, confidence: 0.92 }, tonal: { camelotKey: "8B", confidence: 0.86 }, cuePoints: { mixInSec: 24, mixOutSec: 192 }, segments: [{ label: "intro", startSec: 0, endSec: 32, energy: 0.36 }, { label: "drop", startSec: 80, endSec: 144, energy: 0.8 }, { label: "outro", startSec: 184, endSec: 216, energy: 0.33 }] }],
]);

clock.advance(4_000);
const opened = controller.open({
  source: "planning_window",
  activeTrackId: activeTrack.id,
  deadlineAtMs: computeAgentSessionDeadlineAtMs({
    nowMs: clock.now(),
    remainingSec: 196,
  }),
});
if (opened.outcome !== "opened") throw new Error("could not open mock agent session");

const events: Array<Record<string, unknown>> = [];
const scheduledIds: number[] = [];
const analysisIds: number[] = [];
const playerCalls: DJTimelinePatch[] = [];
const rejectedPlayerIds: number[] = [];
let playerAcceptedAtMs: number | null = null;
let playerAcceptedAtWallMs: number | null = null;

const record = (event: string, details: Record<string, unknown> = {}) => {
  events.push({
    atPlaySec: clock.now() / 1_000,
    atWallMs: Math.round(wallElapsedMs()),
    event,
    ...details,
  });
};
const scheduleOnce = createBoundedAnalysisSchedule(async (ids) => {
  clock.advance(250);
  scheduledIds.splice(0, scheduledIds.length, ...ids);
  record("schedule_track_analysis", { ids: scheduledIds });
  return { enqueued: ids.length, cached: 0, existing: 0 };
});
const readLikes = createDJToolCallBudget({
  toolName: "likes",
  maxCalls: 1,
  execute: async () => {
    clock.advance(1_000);
    record("likes", { count: candidates.length });
    return candidates;
  },
});
const searchTracks = createDJToolCallBudget({
  toolName: "tracks",
  maxCalls: 2,
  execute: async () => {
    clock.advance(1_000);
    record("tracks", { count: candidates.length });
    return candidates;
  },
});
const getMockDJState = () => ({
  activeTrack,
  currentTimeSec: clock.now() / 1_000,
  durationSec: 200,
  section: "intro",
  overallEnergy: 0.52,
  playedTrackIds: [activeTrack.id, ...rejectedPlayerIds],
  setQueue: {
    revision: 0,
    playbackRevision: 0,
    committed: null,
    planned: [],
  },
  performanceMemory: {
    intent: REVIBE_PROMPT,
    playedTracks: [activeTrack],
    recentTransitions: [],
    candidateTrackIds: scheduledIds,
  },
});

const messages: ModelMessage[] = [{ role: "user", content: REVIBE_PROMPT }];
const initialLiveState = getMockDJState();
const initialStateInstruction = getDJLiveStateInstruction(initialLiveState);
const firstMode = getDJAgentMode([messages, initialLiveState]);
const firstPolicy = createDJAgentStepPolicy(messages, { hasInitialDJState: true });
const firstAgent = new ToolLoopAgent({
  id: "ai-dj-chat",
  model,
  instructions: `${systemMessage}\n\n${initialStateInstruction}`,
  stopWhen: [hasToolCall("player"), stepCountIs(MAX_DJ_AGENT_STEPS)],
  tools: {
    dj_state: {
      description: "Read live decks, playback clock, analysis, transition, and recent history.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        clock.advance(1_000);
        record("dj_state");
        return getMockDJState();
      },
    },
    likes: {
      description: "Get liked SoundCloud tracks.",
      inputSchema: z.object({}).passthrough(),
      execute: (input, options) => readLikes(input, options),
    },
    tracks: {
      description: "Search SoundCloud tracks similar to the requested direction.",
      inputSchema: z.object({}).passthrough(),
      execute: (input, options) => searchTracks(input, options),
    },
    schedule_track_analysis: {
      description: "Queue 1-8 strongest candidates for background analysis. Return immediately.",
      inputSchema: z.object({ ids: z.array(z.number().int().positive()).min(1).max(8) }).strict(),
      execute: async ({ ids }: { ids: number[] }) => {
        return scheduleOnce(ids);
      },
    },
    track_analysis: {
      description: "Read one cached rich track analysis.",
      inputSchema: z.object({ id: z.number().int().positive(), aspect: z.string().optional() }).strict(),
      execute: async ({ id }) => {
        clock.advance(500);
        analysisIds.push(id);
        record("track_analysis", { id });
        return analyses.has(id)
          ? { status: "ready", analysis: analyses.get(id) }
          : { status: "not_ready", trackId: String(id) };
      },
    },
    player: {
      description: "Replace the editable set queue with one to three planned tracks.",
      inputSchema: djTimelinePatchSchema,
      execute: async (input) => {
        const started = controller.beginTimelineAction({
          sessionId: opened.session.id,
        });
        if (started.outcome !== "started") throw new Error(`player rejected: ${started.reason}`);
        const headId = input.tracks[0]!.id;
        if (rejectFirstPlayer && rejectedPlayerIds.length === 0) {
          rejectedPlayerIds.push(headId);
          controller.resolveTimelineAction({
            sessionId: opened.session.id,
            succeeded: false,
          });
          record("player_rejected", { id: headId });
          return `Player rejected timeline. Read dj_state, choose a different ID not present in playedTrackIds, and call player again now.`;
        }
        playerCalls.push(input);
        playerAcceptedAtMs = clock.now();
        playerAcceptedAtWallMs = wallElapsedMs();
        controller.resolveTimelineAction({
          sessionId: opened.session.id,
          succeeded: true,
        });
        record("player", { ids: input.tracks.map((track) => track.id) });
        return `Queued ${headId}`;
      },
    },
  },
  prepareStep: ({ stepNumber }) => {
    const choice = getDJAgentToolChoice({
      mode: firstMode,
      stepNumber,
      maxSteps: MAX_DJ_AGENT_STEPS,
      policyChoice: firstPolicy.nextRequiredTool(),
      elapsedMs: wallElapsedMs(),
      decisionDeadlineMs: DJ_PLAYER_DECISION_DEADLINE_MS,
    });
    return choice?.toolName === "player"
      ? { toolChoice: { type: "tool" as const, toolName: "player" as const } }
      : undefined;
  },
  onStepFinish: (step) => firstPolicy.recordStep(step),
});

record("agent_started", { sessionId: opened.session.id });
const firstResult = await firstAgent.generate({
  messages,
  timeout: { totalMs: requestTimeoutMs },
});

let decisionMessages: ModelMessage[] = [
  ...messages,
  ...firstResult.response.messages,
];
if (rejectFirstPlayer) {
  if (rejectedPlayerIds.length === 0) {
    throw new Error(
      "agent_holding_loop: DJ ended the decision turn without calling player",
    );
  }
  if (controller.recordContinuation().outcome !== "continued") {
    throw new Error("same agent session could not continue after player rejection");
  }
  const recoveryLiveState = getMockDJState();
  const recoveryMode = getDJAgentMode([decisionMessages, recoveryLiveState]);
  if (recoveryMode !== "recovery") {
    throw new Error(`expected recovery mode, received ${recoveryMode}`);
  }
  const recoveryPolicy = createDJAgentStepPolicy(decisionMessages, {
    hasInitialDJState: true,
  });
  const recoveryAgent = new ToolLoopAgent({
    id: "ai-dj-chat",
    model,
    instructions: `${systemMessage}\n\n${getDJLiveStateInstruction(recoveryLiveState)}`,
    stopWhen: [hasToolCall("player"), stepCountIs(MAX_DJ_AGENT_STEPS)],
    tools: firstAgent.tools,
    prepareStep: ({ stepNumber }) => {
      const choice = getDJAgentToolChoice({
        mode: recoveryMode,
        stepNumber,
        maxSteps: MAX_DJ_AGENT_STEPS,
        policyChoice: recoveryPolicy.nextRequiredTool(),
        elapsedMs: wallElapsedMs(),
        decisionDeadlineMs: DJ_PLAYER_DECISION_DEADLINE_MS,
      });
      return choice?.toolName === "player"
        ? { toolChoice: { type: "tool" as const, toolName: "player" as const } }
        : undefined;
    },
    onStepFinish: (step) => recoveryPolicy.recordStep(step),
  });
  const recoveryResult = await recoveryAgent.generate({
    messages: decisionMessages,
    timeout: { totalMs: requestTimeoutMs },
  });
  decisionMessages = [...decisionMessages, ...recoveryResult.response.messages];
}

if (
  playerCalls.length !== 1 ||
  playerAcceptedAtMs === null ||
  playerAcceptedAtWallMs === null
) {
  throw new Error(
    `agent_holding_loop: DJ failed to choose; accepted player call count was ${playerCalls.length}; events=${JSON.stringify(events)}`,
  );
}
const selectedTrackId = playerCalls[0]?.tracks[0]?.id;
if (controller.recordContinuation().outcome !== "continued") {
  throw new Error("same agent session could not enter post-player preparation");
}

const continuationMessages: ModelMessage[] = decisionMessages;
const continuationMode = getDJAgentMode(continuationMessages);
const continuationScheduleWasRequired = scheduledIds.length === 0;
let continuationAnalysisScheduled = !continuationScheduleWasRequired;
const continuationAgent = new ToolLoopAgent({
  id: "ai-dj-chat",
  model,
  instructions: systemMessage,
  stopWhen: [
    hasUsablePostPlayerAnalysis,
    stepCountIs(continuationScheduleWasRequired ? 3 : 2),
  ],
  tools: {
    ...(continuationScheduleWasRequired ? {
      schedule_track_analysis: {
        description: "Queue the strongest future candidates for background analysis now.",
        inputSchema: z.object({ ids: z.array(z.number().int().positive()).min(1).max(8) }).strict(),
        execute: async ({ ids }: { ids: number[] }) => {
          const result = await scheduleOnce(ids);
          continuationAnalysisScheduled = true;
          return result;
        },
      },
    } : {}),
    track_analysis: {
      description: `Read one cached rich track analysis for the next transition. Analyze one candidate other than the already queued track ${selectedTrackId}, then finish.`,
      inputSchema: z.object({ id: z.number().int().positive(), aspect: z.string().optional() }).strict(),
      execute: async ({ id }) => {
        if (id === selectedTrackId) {
          record("post_player_analysis_rejected", { id });
          return {
            status: "rejected_selected_track",
            trackId: String(id),
            instruction: "Choose a different prepared candidate and call track_analysis once now.",
          };
        }
        clock.advance(500);
        analysisIds.push(id);
        record("post_player_track_analysis", { id });
        return analyses.has(id)
          ? { status: "ready", analysis: analyses.get(id) }
          : { status: "not_ready", trackId: String(id) };
      },
    },
  },
  prepareStep: ({ stepNumber }) => {
    const choice = getDJAgentToolChoice({
      mode: continuationMode,
      stepNumber,
      maxSteps: MAX_DJ_AGENT_STEPS,
      policyChoice: undefined,
      postPlayerAnalysisScheduled: continuationAnalysisScheduled,
      postPlayerScheduleWasRequired: continuationScheduleWasRequired,
    });
    if (choice?.toolName === "schedule_track_analysis") {
      return {
        toolChoice: { type: "tool" as const, toolName: "schedule_track_analysis" as const },
      };
    }
    return choice?.toolName === "track_analysis"
      ? { toolChoice: { type: "tool" as const, toolName: "track_analysis" as const } }
      : undefined;
  },
});

await continuationAgent.generate({
  messages: continuationMessages,
  timeout: { totalMs: requestTimeoutMs },
});

const postPlayerAnalysis = events.find(({ event }) => event === "post_player_track_analysis");
if (!postPlayerAnalysis) throw new Error("DJ did not start next-track analysis after choosing");
const analysisDelayMs = Number(postPlayerAnalysis.atWallMs) - playerAcceptedAtWallMs;
const result = {
  ok:
    playerCalls.length === 1 &&
    candidates.some(({ id }) => id === selectedTrackId) &&
    !rejectedPlayerIds.includes(selectedTrackId ?? -1) &&
    postPlayerAnalysis.id !== selectedTrackId &&
    analysisDelayMs <= DJ_PLAYER_DECISION_DEADLINE_MS,
  model,
  prompt: REVIBE_PROMPT,
  sessionId: opened.session.id,
  playerCallCount: playerCalls.length,
  rejectedPlayerIds,
  selectedTrackId,
  scheduledIds,
  analysisIds,
  analysisDelayMs,
  fakePlayClockSec: clock.now() / 1_000,
  deadlineAtPlaySec: opened.session.deadlineAtMs / 1_000,
  events,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
