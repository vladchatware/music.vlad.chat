"use client";

import { useEffect, useMemo, useRef } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { playbackDebug, setPlaybackDebugCorrelation } from "@/lib/playbackDebug";
import { compactDJMessages } from "./chatTransport";
import { getPlayableCandidateIds } from "./chatPerformanceMemory";
import {
  djTimelinePatchSchema,
  playerToolInputSchema,
  resolvePreparedPlayerSelection,
  resolvePreparedTimelinePatch,
  type DJTimelinePatch,
  type PlayerToolInput,
} from "@/lib/dj";
import type {
  AgentSession,
  AgentTransportStatus,
} from "./continuityIntent";

export type { PlayerToolInput } from "@/lib/dj";
const DEDUPE_WINDOW_MS = 4000;
const QUEUE_FLUSH_INTERVAL_MS = 400;
export type PlayerRequestOutcome =
  | "ignored"
  | "queued"
  | "playing"
  | "failed"
  | "agent_holding_loop";

export function shouldContinueAgentEpisode(messages: UIMessage[]): boolean {
  return lastAssistantMessageIsCompleteWithToolCalls({ messages });
}

function getPreparedCandidateIds(value: unknown): number[] {
  if (!value || typeof value !== "object") return [];
  const memory = (value as { performanceMemory?: unknown }).performanceMemory;
  if (!memory || typeof memory !== "object") return [];
  const ids = (memory as { candidateTrackIds?: unknown }).candidateTrackIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0)
    : [];
}

export function mergePlayableCandidateIds(
  ...groups: ReadonlyArray<readonly number[]>
): number[] {
  return [...new Set(groups.flat())];
}

export function classifyAgentEpisodeFinish(
  messages: UIMessage[],
  agentSessionState?: AgentSession["state"],
): "continuation" | "completed" | "agent_holding_loop" {
  const shouldContinue = shouldContinueAgentEpisode(messages);
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "assistant") return "completed";
  const lastStepStart = lastMessage.parts.findLastIndex(
    (part) => part.type === "step-start",
  );
  const toolParts = lastMessage.parts
    .slice(lastStepStart + 1)
    .filter((part) =>
      part.type === "dynamic-tool" || part.type.startsWith("tool-")
    );
  const providerTools = toolParts.filter((part) =>
      "providerExecuted" in part &&
      part.providerExecuted === true
    );
  const completedFutureAnalysis = toolParts.some((part) =>
    part.type === "tool-track_analysis" ||
    (
      part.type === "dynamic-tool" &&
      "toolName" in part &&
      part.toolName === "track_analysis"
    )
  );
  if (agentSessionState === "preparing_next" && completedFutureAnalysis) {
    return "completed";
  }
  if (shouldContinue) {
    return "continuation";
  }
  return providerTools.length > 0 ? "agent_holding_loop" : "completed";
}

export function createPlayerToolOrchestrator(opts: {
  onExecute: (input: PlayerToolInput) => Promise<void>;
  onExecutionError?: (error: unknown, input: PlayerToolInput) => void;
  onAgentHoldingLoop?: (input: PlayerToolInput) => void;
  isTransitionBlocked: () => boolean;
  dedupeWindowMs?: number;
  queueFlushIntervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  getAgentSessionId?: () => string | null;
}) {
  const dedupeWindowMs = opts.dedupeWindowMs ?? DEDUPE_WINDOW_MS;
  const queueFlushIntervalMs = opts.queueFlushIntervalMs ?? QUEUE_FLUSH_INTERVAL_MS;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));

  let inFlight = false;
  let queuedPlayerRequest: PlayerToolInput | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const lastPlayerIdAtMs = new Map<number, number>();
  let claimedAgentSessionId: string | null = null;

  const isDuplicatePlayerRequest = (id: number) => {
    const nowMs = now();
    const lastAt = lastPlayerIdAtMs.get(id);
    if (typeof lastAt === "number" && nowMs - lastAt < dedupeWindowMs) {
      return true;
    }
    lastPlayerIdAtMs.set(id, nowMs);

    for (const [cachedId, at] of Array.from(lastPlayerIdAtMs.entries())) {
      if (nowMs - at > dedupeWindowMs * 3) {
        lastPlayerIdAtMs.delete(cachedId);
      }
    }
    return false;
  };

  const execute = async (request: PlayerToolInput): Promise<boolean> => {
    try {
      await opts.onExecute(request);
      return true;
    } catch (error) {
      opts.onExecutionError?.(error, request);
      return false;
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimer(async () => {
      flushTimer = null;
      if (inFlight) {
        scheduleFlush();
        return;
      }

      const nextRequest = queuedPlayerRequest;
      if (nextRequest === null) return;
      const currentAgentSessionId = opts.getAgentSessionId?.() ?? null;
      if (
        claimedAgentSessionId &&
        currentAgentSessionId !== claimedAgentSessionId
      ) {
        queuedPlayerRequest = null;
        claimedAgentSessionId = null;
        return;
      }
      if (opts.isTransitionBlocked()) {
        scheduleFlush();
        return;
      }

      queuedPlayerRequest = null;
      inFlight = true;
      try {
        const succeeded = await execute(nextRequest);
        if (!succeeded && currentAgentSessionId === claimedAgentSessionId) {
          claimedAgentSessionId = null;
        }
      } finally {
        inFlight = false;
        if (queuedPlayerRequest !== null) {
          scheduleFlush();
        }
      }
    }, queueFlushIntervalMs);
  };

  const handlePlayerRequest = async (request: PlayerToolInput): Promise<PlayerRequestOutcome> => {
    const agentSessionId = opts.getAgentSessionId?.() ?? null;
    const id = request.id;
    if (agentSessionId) {
      if (claimedAgentSessionId === agentSessionId) {
        opts.onAgentHoldingLoop?.(request);
        return "agent_holding_loop";
      }
      if (
        claimedAgentSessionId &&
        claimedAgentSessionId !== agentSessionId &&
        (inFlight || queuedPlayerRequest !== null)
      ) {
        opts.onAgentHoldingLoop?.(request);
        return "agent_holding_loop";
      }
    }
    if (isDuplicatePlayerRequest(id)) {
      return "ignored";
    }
    if (agentSessionId) {
      claimedAgentSessionId = agentSessionId;
    }

    if (inFlight || opts.isTransitionBlocked()) {
      queuedPlayerRequest = request; // latest wins
      scheduleFlush();
      return "queued";
    }

    inFlight = true;
    let succeeded = false;
    try {
      succeeded = await execute(request);
    } finally {
      inFlight = false;
    }
    if (queuedPlayerRequest !== null) {
      scheduleFlush();
    }
    if (!succeeded && agentSessionId === claimedAgentSessionId) {
      claimedAgentSessionId = null;
    }
    return succeeded ? "playing" : "failed";
  };

  const dispose = () => {
    if (flushTimer) {
      clearTimer(flushTimer);
      flushTimer = null;
    }
    queuedPlayerRequest = null;
    inFlight = false;
    claimedAgentSessionId = null;
  };

  return { handlePlayerRequest, dispose };
}

export function useRevibeChat(opts: {
  onPlayerToolRequested: (input: PlayerToolInput) => Promise<void>;
  onTimelineToolRequested?: (input: DJTimelinePatch) => Promise<{
    revision: number;
    trackIds: number[];
  }>;
  isTransitionBlocked?: () => boolean;
  getDJState?: () => unknown;
  getAgentSession?: () => AgentSession | null;
  onAgentContinuationRequested?: () => boolean;
  onAgentSessionFinished?: (
    outcome: "completed" | "error" | "aborted" | "agent_holding_loop",
  ) => void;
  onTransportStatus?: (status: AgentTransportStatus) => void;
  onPlayableCandidates?: (trackIds: number[]) => void;
}) {
  const getAgentSessionRef = useRef(opts.getAgentSession);
  const onTransportStatusRef = useRef(opts.onTransportStatus);
  const onAgentSessionFinishedRef = useRef(opts.onAgentSessionFinished);
  const getDJStateRef = useRef(opts.getDJState);
  getAgentSessionRef.current = opts.getAgentSession;
  onTransportStatusRef.current = opts.onTransportStatus;
  onAgentSessionFinishedRef.current = opts.onAgentSessionFinished;
  getDJStateRef.current = opts.getDJState;
  const transport = useMemo(() => new DefaultChatTransport<UIMessage>({
    prepareSendMessagesRequest: ({ id, messages, body }) => {
      const turnId = [...messages].reverse().find((message) => message.role === "user")?.id
        ?? crypto.randomUUID();
      const agentSession = getAgentSessionRef.current?.() ?? null;
      setPlaybackDebugCorrelation({ chatSessionId: id, turnId });
      playbackDebug("chat.turn.requested", {
        messageCount: messages.length,
        agentSessionId: agentSession?.id ?? null,
        agentSessionRevision: agentSession?.revision ?? null,
      });
      return {
        body: {
          ...body,
          messages: compactDJMessages(messages),
          djState: getDJStateRef.current?.(),
          telemetry: {
            chatSessionId: id,
            turnId,
            agentSessionId: agentSession?.id,
            agentSessionRevision: agentSession?.revision,
            activeTrackId: agentSession?.activeTrackId,
            agentSessionElapsedMs: agentSession
              ? Math.max(0, Date.now() - agentSession.openedAtMs)
              : undefined,
            agentSessionRemainingMs: agentSession
              ? Math.max(0, agentSession.deadlineAtMs - Date.now())
              : undefined,
          },
        },
      };
    },
  }), []);
  const onPlayerToolRequestedRef = useRef(opts.onPlayerToolRequested);
  const isTransitionBlockedRef = useRef(opts.isTransitionBlocked);
  const orchestratorRef = useRef<ReturnType<typeof createPlayerToolOrchestrator> | null>(null);
  // Candidate discovery can finish immediately before useChat starts its next
  // automatic continuation. Keep the authoritative tool-result IDs locally so
  // compact player calls do not wait for the parent performance-memory render.
  const playableCandidateIdsRef = useRef<number[]>([]);
  onPlayerToolRequestedRef.current = opts.onPlayerToolRequested;
  isTransitionBlockedRef.current = opts.isTransitionBlocked;

  useEffect(() => {
    orchestratorRef.current = createPlayerToolOrchestrator({
      onExecute: (input) => onPlayerToolRequestedRef.current(input),
      onExecutionError: (error, input) => {
        playbackDebug("chat.tool_call.player_failed", {
          trackId: input.id,
          message: error instanceof Error ? error.message : String(error),
        });
      },
      onAgentHoldingLoop: (input) => {
        playbackDebug("chat.agent_session.player_holding_loop", {
          trackId: input.id,
          agentSessionId: getAgentSessionRef.current?.()?.id ?? null,
        });
        onAgentSessionFinishedRef.current?.("agent_holding_loop");
      },
      isTransitionBlocked: () => isTransitionBlockedRef.current?.() ?? false,
      getAgentSessionId: () => getAgentSessionRef.current?.()?.id ?? null,
    });
    return () => orchestratorRef.current?.dispose();
  }, []);

  const { messages, sendMessage, status, stop, addToolResult, setMessages } = useChat({
    transport,
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const discoveredIds = getPlayableCandidateIds(currentMessages);
      if (discoveredIds.length > 0) {
        playableCandidateIdsRef.current = mergePlayableCandidateIds(
          playableCandidateIdsRef.current,
          discoveredIds,
        );
      }
      const agentSession = getAgentSessionRef.current?.() ?? null;
      if (!agentSession) return false;
      const classification = classifyAgentEpisodeFinish(
        currentMessages,
        agentSession.state,
      );
      if (classification !== "continuation") return false;
      const allowed = opts.onAgentContinuationRequested?.() ?? true;
      playbackDebug("chat.agent_session.continuation", {
        allowed,
        agentSessionId: getAgentSessionRef.current?.()?.id ?? null,
      });
      return allowed;
    },
    onError: (error) => {
      playbackDebug("chat.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      opts.onAgentSessionFinished?.("error");
    },
    onFinish: ({ messages: currentMessages, isAbort, isDisconnect, isError }) => {
      const playableCandidateIds = isAbort || isDisconnect || isError
        ? []
        : getPlayableCandidateIds(currentMessages);
      if (playableCandidateIds.length > 0) {
        playableCandidateIdsRef.current = mergePlayableCandidateIds(
          playableCandidateIdsRef.current,
          playableCandidateIds,
        );
        opts.onPlayableCandidates?.(playableCandidateIds);
        playbackDebug("chat.performance_memory.candidate_capture", {
          count: playableCandidateIds.length,
          ids: playableCandidateIds,
        });
      }
      const classification = classifyAgentEpisodeFinish(
        currentMessages,
        getAgentSessionRef.current?.()?.state,
      );
      playbackDebug("chat.agent_session.response_finished", {
        agentSessionId: getAgentSessionRef.current?.()?.id ?? null,
        classification,
        isAbort,
        isDisconnect,
        isError,
      });
      if (classification === "continuation") return;
      if (classification === "agent_holding_loop") {
        opts.onAgentSessionFinished?.("agent_holding_loop");
        return;
      }
      if (isAbort) {
        opts.onAgentSessionFinished?.("aborted");
      } else if (isDisconnect || isError) {
        opts.onAgentSessionFinished?.("error");
      } else {
        opts.onAgentSessionFinished?.("completed");
      }
    },
    onToolCall: async (ctx) => {
      playbackDebug("chat.tool_call.received", {
        toolName: ctx.toolCall.toolName,
        toolCallId: ctx.toolCall.toolCallId,
        input: ctx.toolCall.input,
      });
      if (ctx.toolCall.toolName === "dj_state") {
        addToolResult({
          tool: ctx.toolCall.toolName,
          toolCallId: ctx.toolCall.toolCallId,
          output: getDJStateRef.current?.() ?? { unavailable: true },
        });
        playbackDebug("chat.tool_call.dj_state", {
          toolCallId: ctx.toolCall.toolCallId,
        });
        return;
      }
      if (ctx.toolCall.toolName !== "player") {
        addToolResult({
          tool: ctx.toolCall.toolName,
          toolCallId: ctx.toolCall.toolCallId,
          output: "Tool handled outside client playback controller.",
        });
        playbackDebug("chat.tool_call.completed_non_player", {
          toolName: ctx.toolCall.toolName,
          toolCallId: ctx.toolCall.toolCallId,
        });
        return;
      }

      const parsedTimeline = djTimelinePatchSchema.safeParse(ctx.toolCall.input);
      const playableCandidateIds = mergePlayableCandidateIds(
        getPreparedCandidateIds(getDJStateRef.current?.()),
        playableCandidateIdsRef.current,
      );
      const preparedTimeline = parsedTimeline.success
        ? null
        : resolvePreparedTimelinePatch(
            ctx.toolCall.input,
            playableCandidateIds,
          );
      const timelineRequest = parsedTimeline.success
        ? parsedTimeline.data
        : preparedTimeline;
      if (timelineRequest && opts.onTimelineToolRequested) {
        try {
          const accepted = await opts.onTimelineToolRequested(timelineRequest);
          const headId = accepted.trackIds[0];
          addToolResult({
            tool: ctx.toolCall.toolName,
            toolCallId: ctx.toolCall.toolCallId,
            output: `Queued ${headId}; timeline revision ${accepted.revision} accepted [${accepted.trackIds.join(", ")}]`,
          });
          playbackDebug("chat.tool_call.timeline_accepted", {
            toolCallId: ctx.toolCall.toolCallId,
            revision: accepted.revision,
            trackIds: accepted.trackIds,
          });
        } catch (error) {
          addToolResult({
            tool: ctx.toolCall.toolName,
            toolCallId: ctx.toolCall.toolCallId,
            output: `Player rejected timeline. Read dj_state and retry with its current setQueue.revision. ${error instanceof Error ? error.message : String(error)}`,
          });
          playbackDebug("chat.tool_call.timeline_rejected", {
            toolCallId: ctx.toolCall.toolCallId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      const parsedInput = playerToolInputSchema.safeParse(ctx.toolCall.input);
      const preparedInput = parsedInput.success
        ? null
        : resolvePreparedPlayerSelection(
            ctx.toolCall.input,
            playableCandidateIds,
          );
      if (!parsedInput.success && !preparedInput) {
        addToolResult({
          tool: ctx.toolCall.toolName,
          toolCallId: ctx.toolCall.toolCallId,
          output: "Player rejected timeline: invalid DJ performance plan. Read dj_state and retry once with its current setQueue.revision.",
        });
        playbackDebug("chat.tool_call.player_rejected", {
          toolCallId: ctx.toolCall.toolCallId,
          issues: parsedInput.error.issues.map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
          })),
        });
        return;
      }
      const request = parsedInput.success ? parsedInput.data : preparedInput!;
      const outcome = await orchestratorRef.current?.handlePlayerRequest(request);

      const output =
        outcome === "failed"
          ? `Player rejected track ${request.id}. Read dj_state, choose a different ID not present in playedTrackIds, and call player again now.`
          : outcome === "agent_holding_loop"
            ? "Agent session already accepted a player action. Stop issuing player calls and finish this session."
          : outcome === "ignored"
          ? `Duplicate player request ignored for ${request.id}. If no transition is active, choose a different unplayed track and call player again.`
          : outcome === "queued"
            ? `Queued ${request.id}`
            : `Playing ${request.id}`;
      addToolResult({
        tool: ctx.toolCall.toolName,
        toolCallId: ctx.toolCall.toolCallId,
        output,
      });
      playbackDebug("chat.tool_call.player_outcome", {
        toolCallId: ctx.toolCall.toolCallId,
        trackId: request.id,
        outcome,
      });
    },
  });

  useEffect(() => {
    playbackDebug("chat.status", { status });
    onTransportStatusRef.current?.(status);
  }, [status]);

  useEffect(() => {
    if (status !== "ready" || getAgentSessionRef.current?.()) return;
    setMessages((currentMessages) => {
      const compacted = compactDJMessages(currentMessages);
      if (
        compacted.length === currentMessages.length &&
        compacted.every((message, index) =>
          message.id === currentMessages[index]?.id &&
          message.parts.length === currentMessages[index]?.parts.length
        )
      ) {
        return currentMessages;
      }
      playbackDebug("chat.history.compacted", {
        before: currentMessages.length,
        after: compacted.length,
      });
      return compacted;
    });
  }, [setMessages, status]);

  return {
    messages: messages as UIMessage[],
    sendMessage,
    status,
    stop,
  };
}
