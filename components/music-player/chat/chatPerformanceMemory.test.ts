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

  it("rejects numeric prefixes from aborted streaming tool inputs", () => {
    const messages = [{
      id: "assistant-aborted",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "schedule_track_analysis",
        toolCallId: "call-aborted",
        state: "input-streaming",
        input: { ids: [719] },
      }],
    }] as UIMessage[];

    expect(getScheduledCandidateIds(messages)).toEqual([]);
  });

  it("does not trust a schedule until its output is available", () => {
    const messages = [{
      id: "assistant-incomplete",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "schedule_track_analysis",
        toolCallId: "call-incomplete",
        state: "input-available",
        input: { ids: [719940358] },
      }],
    }] as UIMessage[];

    expect(getScheduledCandidateIds(messages)).toEqual([]);
  });
});
