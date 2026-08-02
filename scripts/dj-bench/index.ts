import { createMCPClient } from "@ai-sdk/mcp";
import {
  ToolLoopAgent,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { DJ_SHARED_POLICY_VERSION } from "../../lib/dj/agentInstructions";
import {
  MIN_BODY_TRACK_DURATION_SEC,
  MIN_TRACK_DWELL_SEC,
} from "../../lib/dj/lastingSet";

import { benchHelp, parseBenchConfig, type BenchConfig } from "./config";
import { resolveBenchModel } from "./model";
import {
  ANALYSIS_PHASE_INSTRUCTIONS,
  BENCH_DJ_INSTRUCTIONS,
  COMMIT_PHASE_INSTRUCTIONS,
  CONTINUE_SET_PROMPT,
  DISCOVERY_PHASE_INSTRUCTIONS,
  INTERVENTION_PROMPTS,
  REPLENISH_DISCOVERY_INSTRUCTIONS,
  SCHEDULE_PHASE_INSTRUCTIONS,
} from "./prompt";
import {
  MockDJRuntime,
  createPerformTransitionInputSchema,
  extractCandidateTracks,
  extractTrackAnalyses,
  performTransitionInputSchema,
  type CandidateTrack,
  type InitialTrack,
  type PerformTransitionResult,
} from "./runtime";
import {
  writeRunArtifacts,
  writeRunConfig,
  type BenchSummary,
  type CoherenceEvidence,
} from "./report";
import { TraceRecorder } from "./trace";
import type { BenchTimelineManifest } from "./timeline";
import {
  runBrowserContinuationRegression,
  runPreparedSelectionHoldingLoopRegression,
  runPreparedSelectionLatencyRegression,
} from "./playthrough";
import {
  FRUTIGER_AERO_OPENING_TRACKS,
  FRUTIGER_AERO_PREPARED_OPENER_ANALYSIS,
  FRUTIGER_AERO_PREPARED_CONTEXT,
} from "../../lib/dj/performance/frutigerAeroPreparedSet";
import { benchInvalidReason, hasValidCandidatePreparation } from "./validity";

const REMOTE_TOOL_NAMES = [
  "likes",
  "tracks",
  "track_analysis",
  "compare_track_analysis",
  "schedule_track_analysis",
] as const;
const MINIMUM_OPENER_DURATION_SEC = MIN_BODY_TRACK_DURATION_SEC;

interface BenchCounters {
  toolCalls: Record<string, number>;
  toolFailures: Record<string, number>;
  scheduledTrackIds: number[];
  analysisTrackIds: number[];
  falseSuccessClaims: number;
  backstageNarrationCount: number;
  analysisBudgetRejections: number;
  discoveryBudgetRejections: number;
  acceptedWithReadyAnalysis: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  accountedToolWallMs: number;
}

function createCounters(): BenchCounters {
  return {
    toolCalls: {},
    toolFailures: {},
    scheduledTrackIds: [],
    analysisTrackIds: [],
    falseSuccessClaims: 0,
    backstageNarrationCount: 0,
    analysisBudgetRejections: 0,
    discoveryBudgetRejections: 0,
    acceptedWithReadyAnalysis: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    accountedToolWallMs: 0,
  };
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function serializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function collectPositiveIds(value: unknown, ids: number[], seen = new Set<object>()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectPositiveIds(item, ids, seen);
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id === "number" &&
    Number.isSafeInteger(record.id) &&
    record.id > 0
  ) {
    ids.push(record.id);
  }
  if (Array.isArray(record.ids)) {
    for (const id of record.ids) {
      if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ids.push(id);
    }
  }
  for (const child of Object.values(record)) collectPositiveIds(child, ids, seen);
}

function userMessageForTurn(config: BenchConfig, turnIndex: number): string {
  if (turnIndex === 0) return config.prompt;
  if (config.scenario === "interventions") {
    return INTERVENTION_PROMPTS[(turnIndex - 1) % INTERVENTION_PROMPTS.length]!;
  }
  return `${CONTINUE_SET_PROMPT} Persistent direction: ${config.prompt}`;
}

function usageNumber(
  usage: Record<string, unknown>,
  currentName: string,
  legacyName: string,
): number {
  const value = usage[currentName] ?? usage[legacyName];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function connectMcp(config: BenchConfig) {
  try {
    return await createMCPClient({
      transport: {
        type: "http",
        url: config.mcpUrl,
        headers: config.cookie ? { cookie: config.cookie } : undefined,
      },
      clientName: "music-vlad-dj-bench",
      version: "0.1.0",
      maxRetries: 1,
    });
  } catch (error) {
    const details: string[] = [];
    let current: unknown = error;
    while (current && details.length < 5) {
      details.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current));
      current = current instanceof Error ? current.cause : undefined;
    }
    throw new Error(
      `Could not connect to MCP at ${config.mcpUrl}: ${details.join(" <- ")}`,
      { cause: error },
    );
  }
}

async function executeRemoteTool(
  remoteTools: ToolSet,
  name: "likes" | "track_analysis",
  input: unknown,
) {
  const remote = remoteTools[name];
  if (!remote?.execute) {
    throw new Error(`MCP endpoint missing executable ${name} tool`);
  }
  return remote.execute(
    input as never,
    { toolCallId: `bench-bootstrap-${name}`, messages: [] } as never,
  );
}

function analysisNumber(analysis: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = analysis;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" && Number.isFinite(current) && current > 0
    ? current
    : undefined;
}

function analysisString(analysis: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = analysis;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

function normalizedTempoDelta(outgoingBpm: number, incomingBpm: number): number {
  const variants = [incomingBpm / 2, incomingBpm, incomingBpm * 2];
  const equivalent = variants.sort(
    (left, right) => Math.abs(left - outgoingBpm) - Math.abs(right - outgoingBpm),
  )[0]!;
  return Math.abs(outgoingBpm / equivalent - 1) * 100;
}

function buildCoherenceEvidence(runtime: MockDJRuntime | null): CoherenceEvidence[] {
  if (!runtime) return [];
  return runtime.transitionOutcomes.map((transition) => {
    const outgoing = runtime.analysisFor(transition.fromTrackId);
    const incoming = runtime.analysisFor(transition.toTrackId);
    const outgoingBpm = outgoing
      ? analysisNumber(outgoing, ["tempo", "bpm"])
      : undefined;
    const incomingBpm = incoming
      ? analysisNumber(incoming, ["tempo", "bpm"])
      : undefined;
    const outgoingKey = outgoing
      ? analysisString(outgoing, ["tonal", "camelotKey"])
      : undefined;
    const incomingKey = incoming
      ? analysisString(incoming, ["tonal", "camelotKey"])
      : undefined;
    const outgoingEnergy = outgoing
      ? analysisNumber(outgoing, ["energy", "mean"])
      : undefined;
    const incomingEnergy = incoming
      ? analysisNumber(incoming, ["energy", "mean"])
      : undefined;
    return {
      fromTrackId: transition.fromTrackId,
      toTrackId: transition.toTrackId,
      tempo:
        outgoingBpm && incomingBpm
          ? {
              outgoingBpm,
              incomingBpm,
              normalizedDeltaPercent: normalizedTempoDelta(outgoingBpm, incomingBpm),
            }
          : undefined,
      harmonic:
        outgoingKey && incomingKey
          ? {
              outgoingKey,
              incomingKey,
              sameKey: outgoingKey === incomingKey,
            }
          : undefined,
      energy:
        outgoingEnergy && incomingEnergy
          ? {
              outgoingMean: outgoingEnergy,
              incomingMean: incomingEnergy,
              delta: incomingEnergy - outgoingEnergy,
            }
          : undefined,
      analysisComplete: Boolean(outgoing && incoming),
    };
  });
}

async function bootstrapOutgoingTrack(opts: {
  remoteTools: ToolSet;
  config: BenchConfig;
  trace: TraceRecorder;
}): Promise<InitialTrack & { likesOutput: unknown }> {
  const { remoteTools, config, trace } = opts;
  const likesStartedAt = performance.now();
  const likesOutput = await executeRemoteTool(remoteTools, "likes", { limit: 30 });
  const likedCandidates = extractCandidateTracks(likesOutput);
  const preparedOpening = /frutiger\s+aero/i.test(config.prompt);
  const candidates = preparedOpening
    ? extractCandidateTracks(FRUTIGER_AERO_OPENING_TRACKS)
    : likedCandidates;
  trace.record("bootstrap.likes", 0, {
    durationMs: Math.round(performance.now() - likesStartedAt),
    trackIds: likedCandidates.map(({ id }) => id),
    preparedOpeningTrackIds: preparedOpening
      ? candidates.map(({ id }) => id)
      : [],
  });
  if (candidates.length === 0) {
    throw new Error("Could not bootstrap outgoing track: likes returned no tracks");
  }

  let tracksToInspect = candidates
    .filter(({ durationSec }) => durationSec >= MINIMUM_OPENER_DURATION_SEC)
    .slice(0, 10);
  if (config.outgoingTrackId !== undefined) {
    const requested = candidates.find(({ id }) => id === config.outgoingTrackId);
    if (!requested) {
      throw new Error(
        `Outgoing track ${config.outgoingTrackId} was not present in the fetched likes sample`,
      );
    }
    tracksToInspect = [requested];
  }

  if (tracksToInspect.length === 0) {
    throw new Error(
      `Likes sample contained no opener at least ${MINIMUM_OPENER_DURATION_SEC}s long`,
    );
  }

  if (preparedOpening && config.outgoingTrackId === undefined) {
    const preparedTrackId = Number(FRUTIGER_AERO_PREPARED_OPENER_ANALYSIS.trackId);
    const track = tracksToInspect.find(({ id }) => id === preparedTrackId);
    if (!track) {
      throw new Error(`Prepared opener ${preparedTrackId} was not available in the fetched likes sample`);
    }
    trace.record("bootstrap.prepared_outgoing", 0, {
      track,
      analysis: FRUTIGER_AERO_PREPARED_OPENER_ANALYSIS,
    });
    return {
      track,
      analysis: FRUTIGER_AERO_PREPARED_OPENER_ANALYSIS,
      likesOutput,
    };
  }

  for (const track of tracksToInspect) {
    const startedAt = performance.now();
    const output = await executeRemoteTool(remoteTools, "track_analysis", {
      id: track.id,
      aspect: "full",
    });
    const record = extractTrackAnalyses(output).find(({ trackId }) => trackId === track.id);
    trace.record("bootstrap.analysis", 0, {
      trackId: track.id,
      durationMs: Math.round(performance.now() - startedAt),
      status: record ? "ready" : "not_ready",
    });
    if (!record) continue;

    const enrichedTrack: CandidateTrack = {
      ...track,
      bpm: analysisNumber(record.analysis, ["tempo", "bpm"]) ?? track.bpm,
    };
    if (enrichedTrack.durationSec < MINIMUM_OPENER_DURATION_SEC) {
      trace.record("bootstrap.outgoing_skipped", 0, {
        track: enrichedTrack,
        reason: "too_short_for_endurance_set",
        minimumDurationSec: MINIMUM_OPENER_DURATION_SEC,
      });
      continue;
    }
    trace.record("bootstrap.outgoing", 0, {
      track: enrichedTrack,
      analysis: record.analysis,
    });
    return {
      track: enrichedTrack,
      analysis: record.analysis,
      likesOutput,
    };
  }

  throw new Error(
    `No endurance-ready analysis found for ${tracksToInspect.length} liked opener candidate(s)`,
  );
}

function createWrappedRemoteTools(opts: {
  remoteTools: ToolSet;
  runtime: MockDJRuntime;
  trace: TraceRecorder;
  counters: BenchCounters;
  config: BenchConfig;
  bootstrapLikesOutput: unknown;
  syncClock: () => void;
}): { tools: ToolSet; beginTurn: () => void } {
  const {
    remoteTools,
    runtime,
    trace,
    counters,
    config,
    bootstrapLikesOutput,
    syncClock,
  } = opts;
  const wrapped: ToolSet = {};
  let missingAnalysisInjected = false;
  let mcpFailureInjected = false;
  let bootstrapLikesConsumed = false;
  let analysisReadsThisTurn = 0;
  let likesReadsThisTurn = 0;
  let trackSearchesThisTurn = 0;
  let analysisSchedulesThisTurn = 0;

  for (const name of REMOTE_TOOL_NAMES) {
    const remote = remoteTools[name];
    if (!remote?.execute) {
      throw new Error(`MCP endpoint missing executable ${name} tool`);
    }
    const execute = remote.execute;
    wrapped[name] = {
      ...remote,
      execute: async (input: unknown, options: unknown) => {
        syncClock();
        increment(counters.toolCalls, name);
        const startedAt = performance.now();
        trace.record("tool.started", runtime.nowSec, {
          tool: name,
          input: serializable(input),
        });
        try {
          if (name === "likes" || name === "tracks") {
            const used = name === "likes" ? likesReadsThisTurn : trackSearchesThisTurn;
            if (name === "likes") likesReadsThisTurn += 1;
            else trackSearchesThisTurn += 1;
            if (used >= 1) {
              counters.discoveryBudgetRejections += 1;
              increment(counters.toolFailures, name);
              const output = {
                status: "budget_exhausted",
                instruction:
                  "One call to each discovery source is allowed per turn. Continue with current candidates.",
              };
              trace.record("tool.rejected", runtime.nowSec, {
                tool: name,
                reason: "discovery_budget_exhausted",
                output,
              });
              syncClock();
              return output;
            }
          }
          if (name === "tracks" && config.failures.has("mcp") && !mcpFailureInjected) {
            mcpFailureInjected = true;
            throw new Error("Injected MCP search failure");
          }
          if (
            (name === "track_analysis" || name === "compare_track_analysis") &&
            config.failures.has("missing-analysis") &&
            !missingAnalysisInjected
          ) {
            missingAnalysisInjected = true;
            const output = {
              status: "not_ready",
              instruction: "Continue from available metadata; do not poll.",
            };
            trace.record("tool.finished", runtime.nowSec, {
              tool: name,
              durationMs: 0,
              output,
              injectedFailure: "missing-analysis",
            });
            syncClock();
            return output;
          }
          if (name === "track_analysis" || name === "compare_track_analysis") {
            analysisReadsThisTurn += 1;
            if (analysisReadsThisTurn > 2) {
              counters.analysisBudgetRejections += 1;
              increment(counters.toolFailures, name);
              const output = {
                status: "budget_exhausted",
                instruction:
                  "Two analysis reads already used this turn. Refresh dj_state and perform_transition now.",
              };
              trace.record("tool.rejected", runtime.nowSec, {
                tool: name,
                reason: "analysis_budget_exhausted",
                output,
              });
              syncClock();
              return output;
            }
          }
          if (name === "schedule_track_analysis") {
            analysisSchedulesThisTurn += 1;
            if (analysisSchedulesThisTurn > 1) {
              increment(counters.toolFailures, name);
              const output = {
                status: "already_scheduled",
                instruction: "Analysis was already queued this turn. Continue without polling.",
              };
              trace.record("tool.rejected", runtime.nowSec, {
                tool: name,
                reason: "schedule_budget_exhausted",
                output,
              });
              syncClock();
              return output;
            }
          }

          const output =
            name === "likes" && !bootstrapLikesConsumed
              ? (bootstrapLikesConsumed = true, bootstrapLikesOutput)
              : await execute(input as never, options as never);
          const durationMs = Math.round(performance.now() - startedAt);
          counters.accountedToolWallMs += durationMs;
          syncClock();
          if (name === "likes" || name === "tracks") {
            const discovered = runtime.registerCandidates(output);
            trace.record("candidates.discovered", runtime.nowSec, {
              tool: name,
              trackIds: discovered.map(({ id }) => id),
            });
          }
          if (name === "schedule_track_analysis") {
            const ids: number[] = [];
            collectPositiveIds(input, ids);
            counters.scheduledTrackIds.push(...ids);
          }
          if (name === "track_analysis" || name === "compare_track_analysis") {
            const ids: number[] = [];
            collectPositiveIds(input, ids);
            counters.analysisTrackIds.push(...ids);
            const analyses = runtime.registerTrackAnalyses(output);
            trace.record("analysis.discovered", runtime.nowSec, {
              tool: name,
              trackIds: analyses.map(({ trackId }) => trackId),
            });
          }
          trace.record("tool.finished", runtime.nowSec, {
            tool: name,
            durationMs,
            output: serializable(output),
          });
          return output;
        } catch (error) {
          const durationMs = Math.round(performance.now() - startedAt);
          counters.accountedToolWallMs += durationMs;
          syncClock();
          increment(counters.toolFailures, name);
          trace.record("tool.failed", runtime.nowSec, {
            tool: name,
            durationMs,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    } as ToolSet[string];
  }
  return {
    tools: wrapped,
    beginTurn: () => {
      analysisReadsThisTurn = 0;
      likesReadsThisTurn = 0;
      trackSearchesThisTurn = 0;
      analysisSchedulesThisTurn = 0;
    },
  };
}

function createLocalTools(opts: {
  runtime: MockDJRuntime;
  trace: TraceRecorder;
  counters: BenchCounters;
  syncClock: () => void;
}): ToolSet {
  const { runtime, trace, counters, syncClock } = opts;
  return {
    dj_state: {
      description:
        "Read authoritative mock decks, playback clock, transition state, candidates, revision, and played history.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        syncClock();
        increment(counters.toolCalls, "dj_state");
        const state = runtime.readState();
        trace.record("tool.finished", runtime.nowSec, {
          tool: "dj_state",
          output: state,
        });
        return state;
      },
    },
    perform_transition: {
      description:
        "Submit one complete transition. expectedStateRevision must equal latest dj_state revision. Runtime validates availability, duplicates, timing, entry range, blend length, and tempo safety. Rejections are facts: refresh state and recover.",
      inputSchema: createPerformTransitionInputSchema(
        () => runtime.snapshot().candidateTrackIds,
      ),
      execute: async (input): Promise<PerformTransitionResult> => {
        syncClock();
        increment(counters.toolCalls, "perform_transition");
        const hasReadyAnalysis = Boolean(runtime.analysisFor(input.id));
        const result = runtime.performTransition(input);
        if (result.status === "accepted" && hasReadyAnalysis) {
          counters.acceptedWithReadyAnalysis += 1;
        }
        increment(
          result.status === "accepted" ? counters.toolCalls : counters.toolFailures,
          result.status === "accepted" ? "perform_transition.accepted" : "perform_transition.rejected",
        );
        trace.record(
          result.status === "accepted" ? "transition.accepted" : "transition.rejected",
          runtime.nowSec,
          {
            trackId: input.id,
            input: serializable(input),
            output: result,
          },
        );
        return result;
      },
    },
  };
}

export async function runBench(config: BenchConfig) {
  const startedAt = new Date().toISOString();
  const trace = new TraceRecorder(config.tracePath, config.quiet);
  writeRunConfig(config);
  const counters = createCounters();
  let mcp: Awaited<ReturnType<typeof connectMcp>> | null = null;
  let terminalError: string | null = null;
  let messages: ModelMessage[] = [];
  const acceptedTrackIds: number[] = [];
  const agentTranscript: BenchSummary["agentTranscript"] = [];
  let runtime: MockDJRuntime | null = null;
  let outgoingTrack: CandidateTrack | null = null;
  const browserPlaythroughs = [
    runBrowserContinuationRegression(),
    runPreparedSelectionLatencyRegression(),
    runPreparedSelectionHoldingLoopRegression(),
  ];
  for (const browserPlaythrough of browserPlaythroughs) {
    trace.record("playthrough.failure_reproduced", 0, {
      failureId: browserPlaythrough.failureWitness.failureId,
      result: browserPlaythrough.failureWitness,
    });
    trace.record("playthrough.current_verified", 0, {
      failureId: browserPlaythrough.current.failureId,
      result: browserPlaythrough.current,
      passed: browserPlaythrough.passed,
    });
  }

  try {
    mcp = await connectMcp(config);
    const remoteTools = await mcp.tools();
    const bootstrap = await bootstrapOutgoingTrack({
      remoteTools,
      config,
      trace,
    });
    outgoingTrack = bootstrap.track;
    runtime = new MockDJRuntime(
      config.failures,
      config.clockSpeed,
      bootstrap,
      config.planningLeadSec,
    );
    runtime.registerCandidates(bootstrap.likesOutput);
    const preparedOpening = /frutiger\s+aero/i.test(config.prompt);
    if (preparedOpening) {
      runtime.registerCandidates(FRUTIGER_AERO_OPENING_TRACKS);
    }
    const episodeInstructions = preparedOpening
      ? `${BENCH_DJ_INSTRUCTIONS}\n\n${FRUTIGER_AERO_PREPARED_CONTEXT}`
      : BENCH_DJ_INSTRUCTIONS;
    trace.record("episode.started", runtime.nowSec, {
      model: config.model,
      provider: config.provider,
      transitions: config.transitions,
      targetDurationSec: config.targetDurationSec,
      clockSpeed: config.clockSpeed,
      planningLeadSec: config.planningLeadSec,
      failures: [...config.failures],
      scenario: config.scenario,
      mcpUrl: config.mcpUrl,
      outgoingTrack: bootstrap.track,
      instructions: episodeInstructions,
    });
    const model = resolveBenchModel(config);
    let syncRuntimeClock = () => {};
    const remoteToolController = createWrappedRemoteTools({
      remoteTools,
      runtime,
      trace,
      counters,
      config,
      bootstrapLikesOutput: bootstrap.likesOutput,
      syncClock: () => syncRuntimeClock(),
    });
    for (let turnIndex = 0; turnIndex < config.transitions; turnIndex += 1) {
      let lastClockWall = performance.now();
      syncRuntimeClock = () => {
        const now = performance.now();
        runtime.elapseWallMs(now - lastClockWall);
        lastClockWall = now;
      };
      runtime.beginTurn();
      remoteToolController.beginTurn();
      const tools = {
        ...remoteToolController.tools,
        ...createLocalTools({
          runtime,
          trace,
          counters,
          syncClock: () => syncRuntimeClock(),
        }),
      };
      const userText = userMessageForTurn(config, turnIndex);
      messages.push({ role: "user", content: userText });
      const rejectedBeforeTurn = runtime.stats.rejectedTransitions;
      const turnStartedAt = performance.now();
      trace.record("turn.started", runtime.nowSec, {
        turn: turnIndex + 1,
        userText,
        state: runtime.snapshot(),
      });

      const agent = new ToolLoopAgent({
        id: "headless-dj-bench",
        model,
        instructions: episodeInstructions,
        tools,
        stopWhen: [
          () => runtime.acceptedThisTurn,
          stepCountIs(config.maxSteps),
        ],
        prepareStep: ({ stepNumber, steps }) => {
          const prepared = <T extends Record<string, unknown>>(result: T): T => {
            trace.record("agent.step_prepared", runtime.nowSec, {
              turn: turnIndex + 1,
              step: stepNumber,
              userText,
              system: result.system ?? episodeInstructions,
              activeTools: result.activeTools,
              toolChoice: result.toolChoice,
            });
            return result;
          };
          if (stepNumber === 0) {
            return prepared({
              activeTools: ["dj_state"],
              toolChoice: { type: "tool" as const, toolName: "dj_state" },
            });
          }
          const allToolNames = new Set(
            steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
          );
          if (turnIndex === 0 && preparedOpening) {
            return prepared({
              activeTools: ["perform_transition"],
              toolChoice: { type: "tool" as const, toolName: "perform_transition" },
              system: `${episodeInstructions}\n\n${COMMIT_PHASE_INSTRUCTIONS}`,
            });
          }
          if (
            turnIndex === 0 &&
            (!allToolNames.has("likes") || !allToolNames.has("tracks"))
          ) {
            const missingTools = (["likes", "tracks"] as const).filter(
              (name) => !allToolNames.has(name),
            );
            return prepared({
              activeTools: [...missingTools],
              toolChoice:
                missingTools.length === 1
                  ? { type: "tool" as const, toolName: missingTools[0]! }
                  : "required" as const,
              system: `${episodeInstructions}\n\n${DISCOVERY_PHASE_INSTRUCTIONS}`,
            });
          }
          if (
            turnIndex > 0 &&
            runtime.remainingCandidateCount <= 6 &&
            !allToolNames.has("tracks")
          ) {
            return prepared({
              activeTools: ["tracks"],
              toolChoice: { type: "tool" as const, toolName: "tracks" },
              system: `${episodeInstructions}\n\n${REPLENISH_DISCOVERY_INSTRUCTIONS}`,
            });
          }
          const discoveredThisTurn = allToolNames.has("likes") || allToolNames.has("tracks");
          if (discoveredThisTurn && !allToolNames.has("schedule_track_analysis")) {
            return prepared({
              activeTools: ["schedule_track_analysis"],
              toolChoice: { type: "tool" as const, toolName: "schedule_track_analysis" },
              system: `${episodeInstructions}\n\n${SCHEDULE_PHASE_INSTRUCTIONS}`,
            });
          }
          if (
            !allToolNames.has("track_analysis") &&
            !allToolNames.has("compare_track_analysis")
          ) {
            return prepared({
              activeTools: ["track_analysis", "compare_track_analysis"],
              toolChoice: "required" as const,
              system: `${episodeInstructions}\n\n${ANALYSIS_PHASE_INSTRUCTIONS}`,
            });
          }
          const lastToolNames = new Set(
            steps.at(-1)?.toolCalls.map((call) => call.toolName) ?? [],
          );
          if (lastToolNames.has("perform_transition")) {
            return prepared({
              activeTools: ["dj_state"],
              toolChoice: { type: "tool" as const, toolName: "dj_state" },
              system: `${episodeInstructions}\n\n${COMMIT_PHASE_INSTRUCTIONS}`,
            });
          }
          if (lastToolNames.has("dj_state")) {
            return prepared({
              activeTools: ["perform_transition"],
              toolChoice: { type: "tool" as const, toolName: "perform_transition" },
              system: `${episodeInstructions}\n\n${COMMIT_PHASE_INSTRUCTIONS}`,
            });
          }
          return prepared({
            activeTools: ["perform_transition"],
            toolChoice: { type: "tool" as const, toolName: "perform_transition" },
            system: `${episodeInstructions}\n\n${COMMIT_PHASE_INSTRUCTIONS}`,
          });
        },
        onStepFinish: (step) => {
          const stepUsage = step.usage as unknown as Record<string, unknown>;
          counters.inputTokens += usageNumber(stepUsage, "inputTokens", "promptTokens");
          counters.outputTokens += usageNumber(stepUsage, "outputTokens", "completionTokens");
          counters.totalTokens += usageNumber(stepUsage, "totalTokens", "totalTokens");
          const backstageNarration =
            step.text.trim().length > 0 && step.toolCalls.length > 0;
          if (backstageNarration) counters.backstageNarrationCount += 1;
          if (step.text.trim()) {
            agentTranscript.push({
              turn: turnIndex + 1,
              step: step.stepNumber,
              text: step.text,
              reasoningText: step.reasoningText,
              backstageNarration,
            });
          }
          trace.record("agent.step", runtime.nowSec, {
            turn: turnIndex + 1,
            step: step.stepNumber,
            finishReason: step.finishReason,
            text: step.text,
            reasoningText: step.reasoningText,
            toolCalls: serializable(step.toolCalls),
            toolResults: serializable(step.toolResults),
            usage: serializable(step.usage),
            backstageNarration,
          });
        },
      });

      try {
        const stateAtTurnStart = runtime.snapshot();
        const remainingRunwaySec =
          stateAtTurnStart.durationSec - stateAtTurnStart.currentTimeSec - 10;
        if (remainingRunwaySec <= 0) {
          throw new Error("DJ turn started with no planning runway on the active track");
        }
        const physicalRunwayMs = Math.floor(
          remainingRunwaySec / config.clockSpeed * 1_000,
        );
        const turnTimeoutMs = config.timeoutMs === undefined
          ? physicalRunwayMs
          : Math.min(config.timeoutMs, physicalRunwayMs);
        const result = await agent.generate({
          messages,
          timeout: { totalMs: turnTimeoutMs },
        });
        syncRuntimeClock();
        const durationMs = Math.round(performance.now() - turnStartedAt);
        // Runtime state is durable performance memory. Do not carry raw likes,
        // searches, analyses, or tool transcripts into the next planning turn.
        messages = [];

        if (
          !runtime.acceptedThisTurn &&
          runtime.stats.rejectedTransitions > rejectedBeforeTurn &&
          /\b(?:playing|queued|accepted|transitioned)\b/i.test(result.text)
        ) {
          counters.falseSuccessClaims += 1;
          trace.record("agent.false_success_claim", runtime.nowSec, {
            turn: turnIndex + 1,
            text: result.text,
          });
        }
        trace.record("turn.finished", runtime.nowSec, {
          turn: turnIndex + 1,
          durationMs,
          accepted: runtime.acceptedThisTurn,
          text: result.text,
          usage: serializable(result.totalUsage),
        });
      } catch (error) {
        syncRuntimeClock();
        const rawError = error instanceof Error ? error.message : String(error);
        terminalError =
          /(?:Delay was aborted|operation timed out)/i.test(rawError)
            ? `Turn ${turnIndex + 1} exhausted its active-track runway without accepted transition`
            : rawError;
        trace.record("turn.failed", runtime.nowSec, {
          turn: turnIndex + 1,
          error: terminalError,
          rawError,
        });
        break;
      }

      if (!runtime.acceptedThisTurn) {
        terminalError = `Turn ${turnIndex + 1} ended without accepted transition`;
        trace.record("episode.holding_loop", runtime.nowSec, {
          turn: turnIndex + 1,
          error: terminalError,
        });
        break;
      }
      const played = runtime.snapshot().playedTrackIds;
      acceptedTrackIds.push(played.at(-1)!);
      if (runtime.audibleCoverageEndSec >= config.targetDurationSec) {
        trace.record("episode.duration_target_reached", runtime.nowSec, {
          targetDurationSec: config.targetDurationSec,
          achievedDurationSec: runtime.audibleCoverageEndSec,
          transitions: acceptedTrackIds.length,
        });
        break;
      }
      if (turnIndex < config.transitions - 1) {
        runtime.advanceToNextPlanningWindow();
        trace.record("playback.advanced", runtime.nowSec, {
          turn: turnIndex + 1,
          state: runtime.snapshot(),
        });
      }
    }
    if (runtime.audibleCoverageEndSec < config.targetDurationSec && !terminalError) {
      terminalError =
        `Transition safety ceiling reached with ${(runtime.audibleCoverageEndSec / 60).toFixed(1)}` +
        ` of ${(config.targetDurationSec / 60).toFixed(1)} minutes covered`;
      trace.record("episode.duration_target_missed", runtime.nowSec, {
        targetDurationSec: config.targetDurationSec,
        achievedDurationSec: runtime.audibleCoverageEndSec,
        transitions: acceptedTrackIds.length,
      });
    }
  } catch (error) {
    if (!terminalError) {
      terminalError = error instanceof Error ? error.message : String(error);
    }
    trace.record("episode.failed", runtime?.nowSec ?? 0, {
      error: terminalError,
    });
  } finally {
    await mcp?.close().catch(() => {});
  }

  const duplicateAcceptedTracks =
    acceptedTrackIds.length - new Set(acceptedTrackIds).size;
  const analysisCalls =
    (counters.toolCalls.track_analysis ?? 0) +
    (counters.toolCalls.compare_track_analysis ?? 0);
  const stateReads = runtime?.stats.stateReads ?? 0;
  const impossibleScheduleAttempts = runtime?.stats.impossibleScheduleAttempts ?? 0;
  const achievedDurationSec = runtime?.audibleCoverageEndSec ?? 0;
  const reachedTargetDuration = achievedDurationSec >= config.targetDurationSec;
  const maxUncoveredGapSec = runtime?.audibleCoverage(config.targetDurationSec).maxGapSec ?? config.targetDurationSec;
  const completedRatio = Math.min(1, achievedDurationSec / config.targetDurationSec);
  const coherenceEvidence = buildCoherenceEvidence(runtime);
  const completedDwells = (runtime?.transitions ?? []).map((transition) => {
    const segment = runtime?.audibleSegments.find(
      (item) => item.trackId === transition.fromTrackId,
    );
    return Math.max(0, transition.setStartSec - (segment?.setStartSec ?? 0));
  });
  const shortBodyTrackIds = (runtime?.timelineTracks ?? [])
    .filter((track) => track.durationSec < MIN_BODY_TRACK_DURATION_SEC)
    .map((track) => track.id);
  const underMinimumDwellCount = completedDwells.filter(
    (seconds) => seconds + 0.01 < MIN_TRACK_DWELL_SEC,
  ).length;
  const pacingPass = underMinimumDwellCount === 0 && shortBodyTrackIds.length === 0;
  const invalidReason = benchInvalidReason({
    terminalError,
    runtimeStarted: runtime !== null,
    outgoingTrackLoaded: outgoingTrack !== null,
  });
  const summary: BenchSummary = {
    ok:
      terminalError === null &&
      reachedTargetDuration &&
      maxUncoveredGapSec === 0 &&
      duplicateAcceptedTracks === 0 &&
      acceptedTrackIds.length > 0 &&
      stateReads >= acceptedTrackIds.length &&
      impossibleScheduleAttempts === 0 &&
      hasValidCandidatePreparation({
        preparedOpening: /frutiger\s+aero/i.test(config.prompt),
        likesCalls: counters.toolCalls.likes ?? 0,
        tracksCalls: counters.toolCalls.tracks ?? 0,
      }) &&
      analysisCalls > 0 &&
      counters.falseSuccessClaims === 0 &&
      counters.backstageNarrationCount === 0 &&
      pacingPass &&
      browserPlaythroughs.every((proof) => proof.passed),
    validity: invalidReason ? "invalid" : "valid",
    invalidReason,
    runId: config.runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    model: config.model,
    provider: config.provider,
    scenario: config.scenario,
    prompt: config.prompt,
    promptPolicyVersion: DJ_SHARED_POLICY_VERSION,
    planningLeadSec: config.planningLeadSec,
    targetDurationSec: config.targetDurationSec,
    achievedDurationSec,
    reachedTargetDuration,
    maxUncoveredGapSec,
    outgoingTrack,
    requestedTransitions: config.transitions,
    acceptedTransitions: acceptedTrackIds.length,
    acceptedTrackIds,
    duplicateAcceptedTracks,
    stateReads,
    rejectedTransitions: runtime?.stats.rejectedTransitions ?? 0,
    impossibleScheduleAttempts,
    recoverableRunwayRejections: runtime?.stats.recoverableRunwayRejections ?? 0,
    toolCalls: counters.toolCalls,
    toolFailures: counters.toolFailures,
    scheduledTrackIds: [...new Set(counters.scheduledTrackIds)],
    analysisTrackIds: [...new Set(counters.analysisTrackIds)],
    preparedAnalysis: {
      acceptedWithReadyAnalysis: counters.acceptedWithReadyAnalysis,
      coverage: acceptedTrackIds.length > 0
        ? counters.acceptedWithReadyAnalysis / acceptedTrackIds.length
        : 0,
    },
    pacing: {
      status: pacingPass ? "pass" : "fail",
      minimumDwellSec: MIN_TRACK_DWELL_SEC,
      minimumBodyTrackDurationSec: MIN_BODY_TRACK_DURATION_SEC,
      completedDwellsSec: completedDwells,
      underMinimumDwellCount,
      shortBodyTrackIds,
    },
    falseSuccessClaims: counters.falseSuccessClaims,
    backstageNarrationCount: counters.backstageNarrationCount,
    analysisBudgetRejections: counters.analysisBudgetRejections,
    discoveryBudgetRejections: counters.discoveryBudgetRejections,
    browserPlaythroughs,
    tokens: {
      input: counters.inputTokens,
      output: counters.outputTokens,
      total: counters.totalTokens,
    },
    simulatedTimeSec: runtime?.nowSec ?? 0,
    tracePath: config.tracePath,
    summaryPath: config.summaryPath,
    reportPath: config.reportPath,
    configPath: config.configPath,
    manifestPath: config.manifestPath,
    error: terminalError,
    continuity: {
      status:
        terminalError === null &&
        reachedTargetDuration &&
        maxUncoveredGapSec === 0 &&
        impossibleScheduleAttempts === 0
          ? "pass"
          : "fail",
      completedRatio,
      noAcceptedTransition: acceptedTrackIds.length === 0,
      impossibleScheduleAttempts,
      steps: (runtime?.transitionOutcomes ?? []).map((transition) => ({
        fromTrackId: transition.fromTrackId,
        toTrackId: transition.toTrackId,
        acceptedAtSec: transition.acceptedAtSec,
        scheduledAtSec: transition.scheduledAtSec,
        scheduledAtSetSec: transition.scheduledAtSetSec,
        blendDurationSec: transition.blendDurationSec,
      })),
    },
    coherenceEvidence,
    agentTranscript,
    claim:
      "Mechanical bench result only. Musical quality requires real-audio listening review.",
  };
  trace.record("episode.finished", runtime?.nowSec ?? 0, { ...summary });
  const manifest: BenchTimelineManifest = {
    schemaVersion: 1,
    runId: summary.runId,
    model: summary.model,
    provider: summary.provider,
    scenario: summary.scenario,
    prompt: summary.prompt,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    targetDurationSec: summary.targetDurationSec,
    achievedDurationSec: summary.achievedDurationSec,
    tracks: runtime ? [...runtime.timelineTracks] : [],
    audibleSegments: runtime ? [...runtime.audibleSegments] : [],
    transitions: runtime ? [...runtime.transitions] : [],
    events: trace.events.map((event) => {
      const {
        sequence,
        type,
        simulatedTimeSec,
        wallTime,
        wallElapsedMs,
        turn,
        step,
        text,
        reasoningText,
        ...payload
      } = event;
      return {
        id: `event-${sequence}`,
        sequence,
        type,
        setTimeSec: simulatedTimeSec,
        wallTime,
        wallElapsedMs,
        turn: typeof turn === "number" ? turn : undefined,
        step: typeof step === "number" ? step : undefined,
        text: typeof text === "string" ? text : undefined,
        reasoningText: typeof reasoningText === "string" ? reasoningText : undefined,
        payload,
      };
    }),
  };
  writeRunArtifacts(config, summary, manifest);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write(`${benchHelp()}\n`);
  } else {
    try {
      const summary = await runBench(parseBenchConfig());
      if (!summary.ok) process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
