import { describe, expect, it } from "vitest";

import {
  createDJAgentStepPolicy,
  getDiscoveredTrackIds,
  getDJAgentMode,
  getLatestSuccessfulPlayerTrackId,
  hasDJToolCallAfterLatestRejectedPlayer,
  hasRejectedPlayerAction,
  hasDJToolCall,
  hasSuccessfulPlayerAction,
  shouldUsePreparedCandidatePool,
} from "./djAgentPolicy";

describe("createDJAgentStepPolicy candidate memory", () => {
  it("does not repeat discovery when dj_state contains prepared candidates", () => {
    const messages = [{
      role: "user",
      parts: [{ type: "text", text: "play similar hidden gems" }],
    }, {
      role: "assistant",
      parts: [{
        type: "tool-dj_state",
        toolCallId: "state-1",
        state: "output-available",
        input: {},
        output: {
          performanceMemory: { candidateTrackIds: [10, 11, 12] },
        },
      }],
    }];

    const policy = createDJAgentStepPolicy(messages);
    expect(policy.nextRequiredTool()).toBeUndefined();
    expect(shouldUsePreparedCandidatePool(messages)).toBe(true);
  });

  it("forces bounded exploration stages from supplied live state", () => {
    const user = { role: "user", parts: [{ type: "text", text: "discover similar tracks" }] };
    const policy = createDJAgentStepPolicy([user], { hasInitialDJState: true });
    expect(policy.nextRequiredTool()).toEqual({ type: "tool", toolName: "likes" });

    policy.recordStep({ toolName: "likes" });
    expect(policy.nextRequiredTool()).toEqual({ type: "tool", toolName: "tracks" });

    policy.recordStep({ toolName: "tracks" });
    expect(policy.nextRequiredTool()).toEqual({ type: "tool", toolName: "schedule_track_analysis" });

    policy.recordStep({ toolName: "schedule_track_analysis" });
    expect(policy.nextRequiredTool()).toBeUndefined();
  });
});

describe("hasSuccessfulPlayerAction", () => {
  it("recognizes a client-accepted player result", () => {
    expect(hasSuccessfulPlayerAction([{
      role: "assistant",
      parts: [{
        type: "tool-player",
        output: "Playing 42",
      }],
    }])).toBe(true);
  });

  it("reads the accepted track id for future-candidate exclusion", () => {
    expect(getLatestSuccessfulPlayerTrackId([{
      role: "assistant",
      parts: [{ type: "tool-player", output: "Queued 42" }],
    }])).toBe(42);
  });
});

describe("hasRejectedPlayerAction", () => {
  it("recognizes a real client rejection", () => {
    expect(hasRejectedPlayerAction([{
      role: "assistant",
      parts: [{ type: "tool-player", output: "Player rejected track 42." }],
    }])).toBe(true);
  });

  it("recognizes AI SDK model-message tool output", () => {
    expect(hasRejectedPlayerAction([{
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "player",
        output: { type: "text", value: "Player rejected track 42." },
      }],
    }])).toBe(true);
  });

  it("detects recovery state only when it follows the latest rejected player", () => {
    const before = {
      role: "assistant",
      parts: [
        { type: "tool-dj_state", output: { playedTrackIds: [1] } },
        { type: "tool-player", output: "Player rejected track 10." },
      ],
    };
    expect(hasDJToolCallAfterLatestRejectedPlayer([before], "dj_state")).toBe(false);

    const after = {
      role: "assistant",
      parts: [{ type: "tool-dj_state", output: { playedTrackIds: [1, 10] } }],
    };
    expect(hasDJToolCallAfterLatestRejectedPlayer(
      [before, after],
      "dj_state",
    )).toBe(true);
  });
});

describe("getDiscoveredTrackIds", () => {
  it("extracts only IDs returned by likes and tracks tools", () => {
    expect(getDiscoveredTrackIds([{
      role: "assistant",
      parts: [
        {
          type: "tool-likes",
          output: [{ id: 101 }, { id: 102 }],
        },
        {
          type: "dynamic-tool",
          toolName: "tracks",
          output: { collection: [{ id: 103 }, { id: 102 }] },
        },
        {
          type: "tool-dj_state",
          output: { activeTrack: { id: 999 } },
        },
      ],
    }])).toEqual([101, 102, 103]);
  });

  it("extracts leading IDs from MCP text without treating other numbers as tracks", () => {
    expect(getDiscoveredTrackIds([{
      role: "assistant",
      parts: [
        {
          type: "tool-likes",
          output: {
            content: [{
              type: "text",
              text: "201 Artist — Track One (House, 2026)\nnot-a-track 777\n202 Track Two 128 BPM",
            }],
          },
        },
        {
          type: "tool-dj_state",
          output: { content: [{ type: "text", text: "999 must stay ignored" }] },
        },
      ],
    }])).toEqual([201, 202]);
  });
});

describe("hasDJToolCall", () => {
  it("finds scheduled analysis across UI message shapes", () => {
    expect(hasDJToolCall([{
      role: "assistant",
      parts: [{ type: "tool-schedule_track_analysis", input: { ids: [1, 2] } }],
    }], "schedule_track_analysis")).toBe(true);
  });
});

describe("getDJAgentMode", () => {
  it("commits from first completed discovery response instead of opening another research turn", () => {
    const afterLikes = [{
      role: "assistant",
      parts: [{
        type: "tool-likes",
        output: {
          content: [{ type: "text", text: "101 Artist - First (180s)\n102 Artist - Second (210s)" }],
        },
      }],
    }];

    expect(getDJAgentMode(afterLikes)).toBe("prepared_selection");
  });

  it("replays the episode modes without reopening discovery", () => {
    const user = { role: "user", parts: [{ type: "text", text: "play similar hidden gems" }] };
    expect(getDJAgentMode([user])).toBe("fresh_discovery");

    const withPool = [user, {
      role: "assistant",
      parts: [{
        type: "tool-dj_state",
        output: { performanceMemory: { candidateTrackIds: [10, 11, 12] } },
      }],
    }];
    expect(getDJAgentMode(withPool)).toBe("prepared_selection");

    const afterPlayer = [...withPool, {
      role: "assistant",
      parts: [{ type: "tool-player", output: "Playing 10" }],
    }];
    expect(getDJAgentMode(afterPlayer)).toBe("post_player_preparation");
  });

  it("uses recovery tools after rejection even when stale candidates remain", () => {
    expect(getDJAgentMode([{
      role: "assistant",
      parts: [
        { type: "tool-dj_state", output: { performanceMemory: { candidateTrackIds: [10, 11] } } },
        { type: "tool-player", output: "Player rejected track 10." },
      ],
    }])).toBe("recovery");
  });
});
