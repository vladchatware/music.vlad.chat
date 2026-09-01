import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  getPlayableCandidateIds,
  getScheduledCandidateIds,
} from "./chatPerformanceMemory";

describe("getPlayableCandidateIds", () => {
  it("captures completed likes candidates for compact player validation", () => {
    const messages = [{
      id: "assistant-likes",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "likes",
        toolCallId: "call-likes",
        state: "output-available",
        input: {},
        output: { collection: [{ id: 101 }, { id: 102 }, { id: 101 }] },
      }, {
        type: "tool-dj_state",
        toolCallId: "call-state",
        state: "output-available",
        input: {},
        output: { activeTrack: { id: 999 } },
      }],
    }] as UIMessage[];

    expect(getPlayableCandidateIds(messages)).toEqual([101, 102]);
  });
});

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
