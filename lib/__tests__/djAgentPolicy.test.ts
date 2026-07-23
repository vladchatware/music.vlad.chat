import { describe, expect, it } from "vitest";

import {
  createDJAgentStepPolicy,
  getLatestUserText,
  getLatestPlayedTrackIds,
  requiresExploration,
} from "../server/djAgentPolicy";

describe("DJ agent step policy", () => {
  const prompt = "Play hidden gems from my likes or similar tracks, matching frutiger aero";

  it("recognizes mixed-source exploration intent", () => {
    expect(requiresExploration(prompt)).toBe(true);
    expect(requiresExploration("Only play something from my likes")).toBe(false);
    expect(getLatestUserText([
      { role: "user", parts: [{ type: "text", text: prompt }] },
    ])).toBe(prompt);
  });

  it("extracts latest played history from client dj_state output", () => {
    expect(getLatestPlayedTrackIds([
      { type: "tool-dj_state", output: { playedTrackIds: [1, 2] } },
      { type: "tool-dj_state", output: { playedTrackIds: [2, 3, 3, -1, "4"] } },
    ])).toEqual([2, 3]);
  });

  it("requires state, likes, search, and background scheduling in order", () => {
    const policy = createDJAgentStepPolicy([
      { role: "user", parts: [{ type: "text", text: prompt }] },
    ]);

    expect(policy.nextRequiredTool()).toEqual({ type: "tool", toolName: "dj_state" });
    policy.recordStep({ toolCalls: [{ toolName: "dj_state" }] });
    expect(policy.nextRequiredTool()).toEqual({ type: "tool", toolName: "likes" });
    policy.recordStep({ toolCalls: [{ toolName: "likes" }] });
    expect(policy.nextRequiredTool()).toEqual({ type: "tool", toolName: "tracks" });
    policy.recordStep({ toolCalls: [{ toolName: "tracks" }] });
    expect(policy.nextRequiredTool()).toEqual({
      type: "tool",
      toolName: "schedule_track_analysis",
    });
    policy.recordStep({ toolCalls: [{ toolName: "schedule_track_analysis" }] });
    expect(policy.nextRequiredTool()).toBeUndefined();
  });

  it("continues from tool calls preserved in incoming UI messages", () => {
    const policy = createDJAgentStepPolicy([
      { role: "user", parts: [{ type: "text", text: prompt }] },
      {
        role: "assistant",
        parts: [
          { type: "dynamic-tool", toolName: "dj_state" },
          { type: "tool-likes" },
          { type: "tool-tracks" },
        ],
      },
    ]);

    expect(policy.nextRequiredTool()).toEqual({
      type: "tool",
      toolName: "schedule_track_analysis",
    });
  });

  it("forces fresh state and exploration candidates after player rejection", () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: prompt }] },
      {
        role: "assistant",
        parts: [
          { type: "tool-dj_state", output: { playedTrackIds: [10, 20] } },
          { type: "tool-likes", output: "10 liked track" },
          { type: "tool-tracks", output: "20 search result" },
          {
            type: "tool-player",
            output: "Player rejected track 20. Read dj_state, choose a different ID.",
          },
        ],
      },
    ];
    const policy = createDJAgentStepPolicy(messages);

    expect(policy.nextRequiredTool()).toEqual({ type: "tool", toolName: "dj_state" });
    policy.recordStep({ toolCalls: [{ toolName: "dj_state" }] });
    expect(policy.nextRequiredTool()).toEqual({ type: "tool", toolName: "tracks" });
    policy.recordStep({ toolCalls: [{ toolName: "tracks" }] });
    expect(policy.nextRequiredTool()).toEqual({
      type: "tool",
      toolName: "schedule_track_analysis",
    });
  });

  it("does not spend first tool round rereading state attached by client", () => {
    const policy = createDJAgentStepPolicy(
      [
        {
          role: "user",
          parts: [{ type: "text", text: "PERFORMANCE EVENT: transition window approaching." }],
        },
      ],
      { hasInitialDJState: true },
    );

    expect(policy.nextRequiredTool()).toBeUndefined();
  });
});
