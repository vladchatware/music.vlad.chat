"use client";

import { useEffect, useRef } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";

type PlayerToolInput = { id: number };

export function useRevibeChat(opts: {
  onPlayerToolRequested: (id: number) => Promise<void>;
  onKnobsToolRequested: (knobs: any) => Promise<void>;
}) {
  const onPlayerToolRequestedRef = useRef(opts.onPlayerToolRequested);
  const onKnobsToolRequestedRef = useRef(opts.onKnobsToolRequested);

  useEffect(() => {
    onPlayerToolRequestedRef.current = opts.onPlayerToolRequested;
    onKnobsToolRequestedRef.current = opts.onKnobsToolRequested;
  }, [opts.onPlayerToolRequested, opts.onKnobsToolRequested]);

  const { messages, sendMessage, status, addToolResult } = useChat({
    onError: (error) => {
      console.log("error caught", error);
    },
    onToolCall: async (ctx) => {
      console.log(`${ctx.toolCall.toolName} ${JSON.stringify(ctx.toolCall.input)}`);

      if (ctx.toolCall.toolName === "player") {
        const id = (ctx.toolCall.input as PlayerToolInput).id;
        await onPlayerToolRequestedRef.current(id);

        addToolResult({
          tool: ctx.toolCall.toolName,
          toolCallId: ctx.toolCall.toolCallId,
          output: `Playing ${id}`,
        });
      }

      if (ctx.toolCall.toolName === "knobs") {
        await onKnobsToolRequestedRef.current(ctx.toolCall.input);
        console.log("knobs tool executed:", ctx.toolCall.input);

        addToolResult({
          tool: ctx.toolCall.toolName,
          toolCallId: ctx.toolCall.toolCallId,
          output: `Adjusted knobs: ${JSON.stringify(ctx.toolCall.input)}. SUCCESS. REQUIRED: Now you MUST call the 'player' tool to keep the music playing.`,
        });
      }
    },
  });

  return {
    messages: messages as UIMessage[],
    sendMessage,
    status,
  };
}
