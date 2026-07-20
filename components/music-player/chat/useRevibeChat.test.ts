import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlayerToolOrchestrator } from "./useRevibeChat";
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
});
