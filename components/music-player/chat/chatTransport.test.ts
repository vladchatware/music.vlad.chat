import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { compactDJMessages } from "./chatTransport";

describe("compactDJMessages", () => {
  it("keeps only current user turn and removes reasoning while preserving tools", () => {
    const messages = [
      { id: "old-user", role: "user", parts: [{ type: "text", text: "old" }] },
      { id: "old-ai", role: "assistant", parts: [{ type: "text", text: "old answer" }] },
      { id: "user", role: "user", parts: [{ type: "text", text: "keep going" }] },
      {
        id: "ai",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "large hidden trace", state: "done" },
          {
            type: "dynamic-tool",
            toolName: "dj_state",
            toolCallId: "call-1",
            state: "output-available",
            input: {},
            output: { activeTrack: 1 },
          },
        ],
      },
    ] satisfies UIMessage[];

    const compacted = compactDJMessages(messages);
    expect(compacted.map(({ id }) => id)).toEqual(["user", "ai"]);
    expect(compacted[1]?.parts.map(({ type }) => type)).toEqual(["dynamic-tool"]);
  });
});
