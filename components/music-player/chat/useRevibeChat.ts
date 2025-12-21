"use client";

import { useEffect, useRef } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";

import {
  useAgentDJStore,
  type SetEQInput,
  type SetFilterInput,
  type SetTransitionStyleInput,
  type SetVibeInput,
  type SetMixIntensityInput,
  type SetHarmonicModeInput,
  type SetTempoInput,
} from "@/lib/dj/agent";

type PlayerToolInput = { id: number; startAtSec?: number };
type PlayerToolResult = string | void;

// Scheduled action from AI
interface ScheduledAction {
  atSec: number;
  action: string;
  params?: Record<string, any>;
}

export function useRevibeChat(opts: {
  onPlayerToolRequested: (id: number, startAtSec?: number) => Promise<PlayerToolResult>;
  onScheduleActions?: (actions: ScheduledAction[]) => void;
  onRejectTrack?: (reason: string) => Promise<void>;
}) {
  const onPlayerToolRequestedRef = useRef(opts.onPlayerToolRequested);
  const onScheduleActionsRef = useRef(opts.onScheduleActions);
  const onRejectTrackRef = useRef(opts.onRejectTrack);

  useEffect(() => {
    onPlayerToolRequestedRef.current = opts.onPlayerToolRequested;
    onScheduleActionsRef.current = opts.onScheduleActions;
    onRejectTrackRef.current = opts.onRejectTrack;
  }, [opts.onPlayerToolRequested, opts.onScheduleActions, opts.onRejectTrack]);

  const { messages, sendMessage, status, addToolResult } = useChat({
    onError: (error) => {
      console.log("error caught", error);
    },
    onToolCall: async (ctx) => {
      const { toolName, input, toolCallId } = ctx.toolCall;
      console.log(`${toolName} ${JSON.stringify(input)}`);

      const agentActions = useAgentDJStore.getState().actions;

      // Client-side tools - MUST call addToolResult

      // Player tool
      if (toolName === "player") {
        const { id, startAtSec } = input as PlayerToolInput;
        const analysisResult = await onPlayerToolRequestedRef.current(id, startAtSec);
        addToolResult({ tool: toolName, toolCallId, output: analysisResult || `Playing ${id}` });
        return;
      }

      // Schedule actions tool - for precise timestamp-based DJ actions
      if (toolName === "scheduleActions") {
        const { actions } = input as { actions: ScheduledAction[] };
        onScheduleActionsRef.current?.(actions);
        addToolResult({ 
          tool: toolName, 
          toolCallId, 
          output: `Scheduled ${actions.length} actions` 
        });
        return;
      }

      // Reject track tool - AI determined track is not a good match
      if (toolName === "rejectTrack") {
        const { reason } = input as { reason: string };
        await onRejectTrackRef.current?.(reason);
        addToolResult({ 
          tool: toolName, 
          toolCallId, 
          output: `Track rejected: ${reason}. Picking a new track...` 
        });
        return;
      }

      // High-level DJ controls
      if (toolName === "setVibe") {
        const { direction } = input as SetVibeInput;
        agentActions.setVibe(direction);
        addToolResult({ tool: toolName, toolCallId, output: `Vibe: ${direction}` });
        return;
      }

      if (toolName === "setMixIntensity") {
        const { level } = input as SetMixIntensityInput;
        agentActions.setMixIntensity(level);
        addToolResult({ tool: toolName, toolCallId, output: `Intensity: ${level}` });
        return;
      }

      if (toolName === "setHarmonicMode") {
        const { mode } = input as SetHarmonicModeInput;
        agentActions.setHarmonicMode(mode);
        addToolResult({ tool: toolName, toolCallId, output: `Harmonic: ${mode}` });
        return;
      }

      // Fine-tuning controls
      if (toolName === "setTransitionStyle") {
        const { preset, durationBars } = input as SetTransitionStyleInput;
        agentActions.setTransitionStyle({ 
          ...(preset && { eqPreset: preset }),
          ...(durationBars && { durationBars }),
        });
        addToolResult({ tool: toolName, toolCallId, output: `Transition style set` });
        return;
      }

      if (toolName === "setEQ") {
        const { deck, low, mid, high } = input as SetEQInput;
        agentActions.setEQ(deck, { low, mid, high });
        addToolResult({ tool: toolName, toolCallId, output: `EQ adjusted on ${deck}` });
        return;
      }

      if (toolName === "setFilter") {
        const { deck, type, frequency, resonance } = input as SetFilterInput;
        agentActions.setFilter(deck, { type, frequency, resonance, enabled: true });
        addToolResult({ tool: toolName, toolCallId, output: `${type} filter at ${frequency}Hz` });
        return;
      }

      if (toolName === "setTempo") {
        const { adjustment } = input as SetTempoInput;
        agentActions.setTempoAdjustment(adjustment);
        addToolResult({ tool: toolName, toolCallId, output: `Tempo: ${adjustment > 0 ? '+' : ''}${adjustment}%` });
        return;
      }

      // MCP tools (likes, tracks, users, playlists) - server already executed
      // Do nothing - don't call addToolResult, just return
    },
  });
  
  return {
    messages: messages as UIMessage[],
    sendMessage,
    status,
  };
}
