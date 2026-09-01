import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { buildDJChatSessionManifest, type StoredDJChatSession } from "./djChatSessionManifest";

const performance = {
  energyArc: "build",
  exit: { anchor: "next_phrase" },
  entry: { anchor: "mix_in" },
  blend: {
    duration: { bars: 8 },
    crossfaderCurve: "equal_power",
    eq: "bass_swap",
  },
  tempo: { mode: "preserve" },
  reason: "Keep the energy moving.",
} as const;

function messages(parts: unknown[]): UIMessage[] {
  return [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Play hidden gems" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts,
    },
  ] as unknown as UIMessage[];
}

function djState(planned = false) {
  return {
    state: planned ? "planned" : "playing",
    activeDeck: {
      id: "A",
      track: {
        id: 11,
        title: "Outgoing",
        artist: "DJ A",
        bpm: 120,
        duration: 180,
      },
      positionSec: planned ? 30 : 10,
      durationSec: 180,
    },
    cuedTrack: planned
      ? {
          track: {
            id: 22,
            title: "Incoming",
            artist: "DJ B",
            bpm: 122,
            duration: 160,
          },
        }
      : null,
    plannedExit: planned ? { atSec: 50 } : null,
    transition: planned
      ? { state: "planned", plannedStartSec: 50, durationSec: 8 }
      : { state: "none" },
  };
}

describe("buildDJChatSessionManifest", () => {
  it("adapts stored chat continuations into the canonical bench timeline contract", () => {
    const start = Date.parse("2026-09-02T00:00:00.000Z");
    const stored: StoredDJChatSession = {
      session: {
        sessionKey: "chat-session",
        model: "zai/glm-5.3-flash",
        createdAt: start,
        updatedAt: start + 30_000,
        turnCount: 2,
      },
      turns: [
        {
          captureKey: "capture-1",
          turnKey: "turn-1",
          startedAt: start,
          completedAt: start + 5_000,
          finishReason: "tool-calls",
          isAborted: false,
          snapshot: {
            schemaVersion: 1,
            chatSessionId: "chat-session",
            captureId: "capture-1",
            turnId: "turn-1",
            model: "zai/glm-5.3-flash",
            startedAt: new Date(start).toISOString(),
            completedAt: new Date(start + 5_000).toISOString(),
            messages: messages([
              { type: "reasoning", text: "Find candidates." },
              {
                type: "dynamic-tool",
                toolName: "likes",
                toolCallId: "likes-1",
                input: { limit: 20 },
                output: "results",
              },
            ]),
            djState: djState(false),
            outcome: { finishReason: "tool-calls", isAborted: false },
          },
        },
        {
          captureKey: "capture-2",
          turnKey: "turn-1",
          startedAt: start + 6_000,
          completedAt: start + 12_000,
          finishReason: "tool-calls",
          isAborted: false,
          snapshot: {
            schemaVersion: 1,
            chatSessionId: "chat-session",
            captureId: "capture-2",
            turnId: "turn-1",
            model: "zai/glm-5.3-flash",
            startedAt: new Date(start + 6_000).toISOString(),
            completedAt: new Date(start + 12_000).toISOString(),
            messages: messages([
              { type: "reasoning", text: "Find candidates." },
              {
                type: "dynamic-tool",
                toolName: "likes",
                toolCallId: "likes-1",
                input: { limit: 20 },
                output: "results",
              },
              { type: "step-start" },
              { type: "reasoning", text: "Choose the next track." },
              {
                type: "dynamic-tool",
                toolName: "player",
                toolCallId: "player-1",
                input: {
                  id: 22,
                  energyArc: performance.energyArc,
                  reason: performance.reason,
                },
                output: "Playing 22",
              },
            ]),
            djState: djState(true),
            outcome: { finishReason: "tool-calls", isAborted: false },
          },
        },
      ],
    };

    const manifest = buildDJChatSessionManifest(stored);

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      runId: "chat-session",
      provider: "zai",
      scenario: "live-chat",
      prompt: "Play hidden gems",
      achievedDurationSec: 30,
    });
    expect(manifest.tracks.map((track) => track.id)).toEqual([11, 22]);
    expect(manifest.audibleSegments.map((segment) => segment.trackId)).toEqual([11, 22]);
    expect(manifest.transitions).toHaveLength(1);
    expect(manifest.transitions[0]).toMatchObject({
      fromTrackId: 11,
      toTrackId: 22,
      setStartSec: 26,
      blendDurationSec: 8,
      performance,
    });
    expect(manifest.events.filter((event) => event.type === "agent.step")).toHaveLength(2);
    expect(manifest.events.filter((event) => event.type === "tool.likes")).toHaveLength(1);
    expect(manifest.events.filter((event) => event.type === "tool.player")).toHaveLength(1);
    expect(manifest.events.find((event) => event.type === "tool.player")?.payload.input)
      .toEqual({
        id: 22,
        energyArc: performance.energyArc,
        reason: performance.reason,
      });
  });
});
