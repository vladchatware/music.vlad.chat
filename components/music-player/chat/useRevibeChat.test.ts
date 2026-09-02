import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPlayerToolOrchestrator,
  classifyAgentEpisodeFinish,
  mergePlayableCandidateIds,
  shouldContinueAgentEpisode,
} from "./useRevibeChat";
import { createContinuityIntentController } from "./continuityIntent";
import type { PlayerToolInput } from "./useRevibeChat";

const request = (id: number): PlayerToolInput => ({
  id,
  performance: {
    energyArc: "preserve",
    exit: { anchor: "mix_out" },
    entry: { anchor: "mix_in" },
    blend: {
      duration: { bars: 8 },
      crossfaderCurve: "equal_power",
      eq: "bass_swap",
    },
    tempo: { mode: "match", maxAdjustmentPercent: 8 },
    reason: "fixture",
  },
});

describe("mergePlayableCandidateIds", () => {
  it("keeps tool-result candidates available across an automatic continuation", () => {
    expect(mergePlayableCandidateIds([101, 102], [102, 103])).toEqual([
      101,
      102,
      103,
    ]);
  });
});

describe("createPlayerToolOrchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("dedupes repeated requests for the same track within the dedupe window", async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createPlayerToolOrchestrator({
      onExecute,
      isTransitionBlocked: () => false,
    });

    await expect(orchestrator.handlePlayerRequest(request(42))).resolves.toBe("playing");
    await expect(orchestrator.handlePlayerRequest(request(42))).resolves.toBe("ignored");

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith(request(42));
    orchestrator.dispose();
  });

  it("queues only the latest request while transitions are blocked", async () => {
    let blocked = true;
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createPlayerToolOrchestrator({
      onExecute,
      isTransitionBlocked: () => blocked,
    });

    await expect(orchestrator.handlePlayerRequest(request(10))).resolves.toBe("queued");
    await expect(orchestrator.handlePlayerRequest(request(11))).resolves.toBe("queued");

    blocked = false;
    await vi.advanceTimersByTimeAsync(500);

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith(request(11));
    orchestrator.dispose();
  });

  it("single-flights execution and flushes latest queued request after in-flight completes", async () => {
    let resolveFirst: (() => void) | null = null;
    const onExecute = vi.fn().mockImplementation((input: PlayerToolInput) => {
      if (input.id !== 1) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    });

    const orchestrator = createPlayerToolOrchestrator({
      onExecute,
      isTransitionBlocked: () => false,
    });

    const first = orchestrator.handlePlayerRequest(request(1));
    await Promise.resolve();

    await expect(orchestrator.handlePlayerRequest(request(2))).resolves.toBe("queued");
    await expect(orchestrator.handlePlayerRequest(request(3))).resolves.toBe("queued");

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith(request(1));

    resolveFirst?.();
    await first;
    await vi.advanceTimersByTimeAsync(500);

    expect(onExecute.mock.calls.map((call) => call[0].id)).toEqual([1, 3]);
    orchestrator.dispose();
  });

  it("returns failed and reports execution rejection", async () => {
    const error = new Error("Timed out waiting for deck B canplay");
    const onExecutionError = vi.fn();
    const orchestrator = createPlayerToolOrchestrator({
      onExecute: vi.fn().mockRejectedValue(error),
      onExecutionError,
      isTransitionBlocked: () => false,
    });

    await expect(orchestrator.handlePlayerRequest(request(42))).resolves.toBe("failed");
    expect(onExecutionError).toHaveBeenCalledWith(error, request(42));
    orchestrator.dispose();
  });

  it("treats a second accepted player action in one agent session as holding-loop failure", async () => {
    let sessionId = "session-1";
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createPlayerToolOrchestrator({
      onExecute,
      isTransitionBlocked: () => false,
      getAgentSessionId: () => sessionId,
    });

    await expect(orchestrator.handlePlayerRequest(request(10))).resolves.toBe("playing");
    await expect(orchestrator.handlePlayerRequest(request(11))).resolves.toBe(
      "agent_holding_loop",
    );
    expect(onExecute.mock.calls.map((call) => call[0].id)).toEqual([10]);

    sessionId = "session-2";
    await expect(orchestrator.handlePlayerRequest(request(12))).resolves.toBe("playing");
    expect(onExecute.mock.calls.map((call) => call[0].id)).toEqual([10, 12]);
    orchestrator.dispose();
  });

  it("treats a repeated same-track player call after acceptance as holding-loop failure", async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const onAgentHoldingLoop = vi.fn();
    const orchestrator = createPlayerToolOrchestrator({
      onExecute,
      onAgentHoldingLoop,
      isTransitionBlocked: () => false,
      getAgentSessionId: () => "session-1",
    });

    await expect(orchestrator.handlePlayerRequest(request(10))).resolves.toBe("playing");
    await expect(orchestrator.handlePlayerRequest(request(10))).resolves.toBe(
      "agent_holding_loop",
    );
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onAgentHoldingLoop).toHaveBeenCalledOnce();
    expect(onAgentHoldingLoop).toHaveBeenCalledWith(request(10));
    orchestrator.dispose();
  });

  it("treats another player call while same session action is in flight as holding-loop failure", async () => {
    let resolveFirst: (() => void) | null = null;
    const onExecute = vi.fn().mockImplementation(() =>
      new Promise<void>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const orchestrator = createPlayerToolOrchestrator({
      onExecute,
      isTransitionBlocked: () => false,
      getAgentSessionId: () => "session-1",
    });

    const first = orchestrator.handlePlayerRequest(request(20));
    await Promise.resolve();
    await expect(orchestrator.handlePlayerRequest(request(21))).resolves.toBe(
      "agent_holding_loop",
    );
    expect(onExecute).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await first;
    orchestrator.dispose();
  });

  it("claims a queued player action so same session cannot replace it", async () => {
    let blocked = true;
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createPlayerToolOrchestrator({
      onExecute,
      isTransitionBlocked: () => blocked,
      getAgentSessionId: () => "session-1",
    });

    await expect(orchestrator.handlePlayerRequest(request(30))).resolves.toBe("queued");
    await expect(orchestrator.handlePlayerRequest(request(31))).resolves.toBe(
      "agent_holding_loop",
    );

    blocked = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(onExecute.mock.calls.map((call) => call[0].id)).toEqual([30]);
    orchestrator.dispose();
  });

  it("recovers once, accepts one action, then terminates an extra player call", async () => {
    const controller = createContinuityIntentController({
      generateId: () => "session-1",
      now: () => 1_000,
    });
    const opened = controller.open({
      source: "planning_window",
      activeTrackId: 1,
      deadlineAtMs: 60_000,
    });
    if (opened.outcome !== "opened") throw new Error("expected open session");

    let rejectFirst = true;
    const acceptedIds: number[] = [];
    const orchestrator = createPlayerToolOrchestrator({
      getAgentSessionId: () => controller.getActive()?.id ?? null,
      isTransitionBlocked: () => false,
      onExecute: async (input) => {
        const started = controller.beginPlayerAction({
          sessionId: opened.session.id,
          activeTrackId: 1,
        });
        if (started.outcome !== "started") throw new Error(started.reason);
        if (rejectFirst) {
          rejectFirst = false;
          controller.resolvePlayerAction({
            sessionId: opened.session.id,
            activeTrackId: 1,
            succeeded: false,
          });
          throw new Error("deck rejected");
        }
        acceptedIds.push(input.id);
        controller.resolvePlayerAction({
          sessionId: opened.session.id,
          activeTrackId: 1,
          succeeded: true,
        });
      },
      onAgentHoldingLoop: () => {
        controller.close(opened.session.id, "agent_holding_loop");
      },
    });

    await expect(orchestrator.handlePlayerRequest(request(20))).resolves.toBe("failed");
    expect(controller.recordContinuation()).toEqual({ outcome: "continued", count: 1 });
    await expect(orchestrator.handlePlayerRequest(request(21))).resolves.toBe("playing");
    await expect(orchestrator.handlePlayerRequest(request(22))).resolves.toBe(
      "agent_holding_loop",
    );

    expect(acceptedIds).toEqual([21]);
    expect(controller.getActive()).toBeNull();
    orchestrator.dispose();
  });
});

describe("shouldContinueAgentEpisode", () => {
  it("continues completed tool calls inside same agent session", () => {
    expect(
      shouldContinueAgentEpisode([
        {
          id: "assistant-tool",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "track_analysis",
              toolCallId: "call-1",
              state: "output-available",
              input: { track_id: 10 },
              output: { status: "complete" },
            },
          ],
        },
      ]),
    ).toBe(true);
  });

  it("ends session on terminal assistant text", () => {
    expect(
      shouldContinueAgentEpisode([
        {
          id: "assistant-text",
          role: "assistant",
          parts: [{ type: "text", text: "Transition planned." }],
        },
      ]),
    ).toBe(false);
  });

});

describe("classifyAgentEpisodeFinish", () => {
  it("treats terminal provider tool calls without player as holding-loop failure", () => {
    expect(
      classifyAgentEpisodeFinish([
        {
          id: "assistant-analysis",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "track_analysis",
              toolCallId: "analysis-1",
              state: "output-available",
              input: { id: 10 },
              output: { status: "ready" },
              providerExecuted: true,
            },
          ],
        },
      ]),
    ).toBe("agent_holding_loop");
  });

  it("classifies terminal assistant text as completed", () => {
    expect(
      classifyAgentEpisodeFinish([
        {
          id: "assistant-text",
          role: "assistant",
          parts: [{ type: "text", text: "Done." }],
        },
      ]),
    ).toBe("completed");
  });

  it("finishes preparation after future-track analysis instead of continuing again", () => {
    expect(classifyAgentEpisodeFinish([{
      id: "assistant-1",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "track_analysis",
        toolCallId: "analysis-1",
        state: "output-available",
        input: { id: 202 },
        output: { status: "ready" },
      }],
    }], "preparing_next")).toBe("completed");
  });
});
