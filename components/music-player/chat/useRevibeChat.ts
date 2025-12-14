"use client";

import { useEffect, useRef } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";

type PlayerToolInput = { id: number };

export function useRevibeChat(opts: {
  onPlayerToolRequested: (id: number) => Promise<void>;
}) {
  const onPlayerToolRequestedRef = useRef(opts.onPlayerToolRequested);

  useEffect(() => {
    onPlayerToolRequestedRef.current = opts.onPlayerToolRequested;
  }, [opts.onPlayerToolRequested]);

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
    },
  });

  return {
    messages: messages as UIMessage[],
    sendMessage,
    status,
  };
}

