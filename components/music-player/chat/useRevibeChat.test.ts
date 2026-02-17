import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlayerToolOrchestrator } from "./useRevibeChat";

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

    await expect(orchestrator.handlePlayerRequest(42)).resolves.toBe("playing");
    await expect(orchestrator.handlePlayerRequest(42)).resolves.toBe("ignored");

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith(42);
    orchestrator.dispose();
  });

  it("queues only the latest request while transitions are blocked", async () => {
    let blocked = true;
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createPlayerToolOrchestrator({
      onExecute,
      isTransitionBlocked: () => blocked,
    });

    await expect(orchestrator.handlePlayerRequest(10)).resolves.toBe("queued");
    await expect(orchestrator.handlePlayerRequest(11)).resolves.toBe("queued");

    blocked = false;
    await vi.advanceTimersByTimeAsync(500);

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith(11);
    orchestrator.dispose();
  });

  it("single-flights execution and flushes latest queued request after in-flight completes", async () => {
    let resolveFirst: (() => void) | null = null;
    const onExecute = vi.fn().mockImplementation((id: number) => {
      if (id !== 1) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    });

    const orchestrator = createPlayerToolOrchestrator({
      onExecute,
      isTransitionBlocked: () => false,
    });

    const first = orchestrator.handlePlayerRequest(1);
    await Promise.resolve();

    await expect(orchestrator.handlePlayerRequest(2)).resolves.toBe("queued");
    await expect(orchestrator.handlePlayerRequest(3)).resolves.toBe("queued");

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith(1);

    resolveFirst?.();
    await first;
    await vi.advanceTimersByTimeAsync(500);

    expect(onExecute.mock.calls.map((call) => call[0])).toEqual([1, 3]);
    orchestrator.dispose();
  });
});

