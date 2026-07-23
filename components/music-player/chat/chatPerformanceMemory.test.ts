import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { getScheduledCandidateIds } from "./chatPerformanceMemory";

describe("getScheduledCandidateIds", () => {
  it("extracts scheduled IDs from completed tool calls", () => {
    const messages = [{
      id: "assistant-1",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "schedule_track_analysis",
        toolCallId: "call-1",
        state: "output-available",
        input: { ids: [4, 5, 5, 6, -1] },
        output: { status: "scheduled" },
      }],
    }] as UIMessage[];

    expect(getScheduledCandidateIds(messages)).toEqual([4, 5, 6]);
  });
});
