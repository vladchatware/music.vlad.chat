"use client";

import { useEffect, useRef } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { playbackDebug } from "@/lib/playbackDebug";

type PlayerToolInput = { id: number };
const DEDUPE_WINDOW_MS = 4000;
const QUEUE_FLUSH_INTERVAL_MS = 400;
export type PlayerRequestOutcome = "ignored" | "queued" | "playing";

export function createPlayerToolOrchestrator(opts: {
  onExecute: (id: number) => Promise<void>;
  isTransitionBlocked: () => boolean;
  dedupeWindowMs?: number;
  queueFlushIntervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}) {
  const dedupeWindowMs = opts.dedupeWindowMs ?? DEDUPE_WINDOW_MS;
  const queueFlushIntervalMs = opts.queueFlushIntervalMs ?? QUEUE_FLUSH_INTERVAL_MS;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));

  let inFlight = false;
  let queuedPlayerId: number | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const lastPlayerIdAtMs = new Map<number, number>();

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

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimer(async () => {
      flushTimer = null;
      if (inFlight) {
        scheduleFlush();
        return;
      }

      const nextId = queuedPlayerId;
      if (nextId === null) return;
      if (opts.isTransitionBlocked()) {
        scheduleFlush();
        return;
      }

      queuedPlayerId = null;
      inFlight = true;
      try {
        await opts.onExecute(nextId);
      } finally {
        inFlight = false;
        if (queuedPlayerId !== null) {
          scheduleFlush();
        }
      }
    }, queueFlushIntervalMs);
  };

  const handlePlayerRequest = async (id: number): Promise<PlayerRequestOutcome> => {
    if (isDuplicatePlayerRequest(id)) {
      return "ignored";
    }

    if (inFlight || opts.isTransitionBlocked()) {
      queuedPlayerId = id; // latest wins
      scheduleFlush();
      return "queued";
    }

    inFlight = true;
    try {
      await opts.onExecute(id);
    } finally {
      inFlight = false;
    }
    if (queuedPlayerId !== null) {
      scheduleFlush();
    }
    return "playing";
  };

  const dispose = () => {
    if (flushTimer) {
      clearTimer(flushTimer);
      flushTimer = null;
    }
    queuedPlayerId = null;
    inFlight = false;
  };

  return { handlePlayerRequest, dispose };
}

export function useRevibeChat(opts: {
  onPlayerToolRequested: (id: number) => Promise<void>;
  isTransitionBlocked?: () => boolean;
}) {
  const onPlayerToolRequestedRef = useRef(opts.onPlayerToolRequested);
  const isTransitionBlockedRef = useRef(opts.isTransitionBlocked);
  const orchestratorRef = useRef<ReturnType<typeof createPlayerToolOrchestrator> | null>(null);

  useEffect(() => {
    onPlayerToolRequestedRef.current = opts.onPlayerToolRequested;
  }, [opts.onPlayerToolRequested]);

  useEffect(() => {
    isTransitionBlockedRef.current = opts.isTransitionBlocked;
  }, [opts.isTransitionBlocked]);

  useEffect(() => {
    orchestratorRef.current = createPlayerToolOrchestrator({
      onExecute: (id) => onPlayerToolRequestedRef.current(id),
      isTransitionBlocked: () => isTransitionBlockedRef.current?.() ?? false,
    });
    return () => orchestratorRef.current?.dispose();
  }, []);

  const { messages, sendMessage, status, addToolResult } = useChat({
    onError: (error) => {
      playbackDebug("chat.error", {
        message: error instanceof Error ? error.message : String(error),
      });
    },
    onToolCall: async (ctx) => {
      playbackDebug("chat.tool_call.received", {
        toolName: ctx.toolCall.toolName,
        toolCallId: ctx.toolCall.toolCallId,
        input: ctx.toolCall.input,
      });
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

      const id = (ctx.toolCall.input as PlayerToolInput).id;
      const outcome = await orchestratorRef.current?.handlePlayerRequest(id);

      const output =
        outcome === "ignored"
          ? `Ignored duplicate player request for ${id}`
          : outcome === "queued"
            ? `Queued ${id}`
            : `Playing ${id}`;
      addToolResult({
        tool: ctx.toolCall.toolName,
        toolCallId: ctx.toolCall.toolCallId,
        output,
      });
      playbackDebug("chat.tool_call.player_outcome", {
        toolCallId: ctx.toolCall.toolCallId,
        trackId: id,
        outcome,
      });
    },
  });

  useEffect(() => {
    playbackDebug("chat.status", { status });
  }, [status]);

  return {
    messages: messages as UIMessage[],
    sendMessage,
    status,
  };
}
