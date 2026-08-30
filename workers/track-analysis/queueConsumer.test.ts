import { describe, expect, it, vi } from "vitest";
import type { MessageMetadata } from "@vercel/queue";
import {
  createQueueMessageHandler,
  createQueueRetryPolicy,
  deliveryBackoffSeconds,
  MAX_QUEUE_DELIVERY_COUNT,
  QueueRetrySignal,
  retrySeconds,
} from "./queueConsumer";

function metadata(deliveryCount = 1): MessageMetadata {
  return {
    messageId: "msg-1",
    deliveryCount,
    createdAt: new Date(0),
    expiresAt: new Date(86_400_000),
    topicName: "track-analysis",
    consumerGroup: "track-analysis-worker",
    region: "iad1",
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    trackId: "42",
    analysisVersion: "essentia-dj-v1",
    priority: 0,
    ...overrides,
  };
}

function createDeps(overrides: Partial<Parameters<typeof createQueueMessageHandler>[0]> = {}) {
  const convexQueue = { claimSpecific: vi.fn() };
  const processJob = vi.fn();
  return {
    deps: {
      convexQueue,
      processJob,
      now: vi.fn(() => 1_000_000),
      ...overrides,
    },
    convexQueue,
    processJob,
  };
}

describe("retrySeconds", () => {
  it("clamps delays into the queue's allowed retry window", () => {
    expect(retrySeconds(0)).toBe(1);
    expect(retrySeconds(-5_000)).toBe(1);
    expect(retrySeconds(90_000)).toBe(90);
    expect(retrySeconds(10 * 60 * 1_000)).toBe(600);
    expect(retrySeconds(24 * 60 * 60 * 1_000)).toBe(3_600);
    expect(retrySeconds(Number.NaN)).toBe(1);
  });
});

describe("deliveryBackoffSeconds", () => {
  it("doubles with delivery count and caps at five minutes", () => {
    expect(deliveryBackoffSeconds(1)).toBe(30);
    expect(deliveryBackoffSeconds(2)).toBe(60);
    expect(deliveryBackoffSeconds(3)).toBe(120);
    expect(deliveryBackoffSeconds(5)).toBe(300);
    expect(deliveryBackoffSeconds(20)).toBe(300);
  });
});

describe("createQueueMessageHandler", () => {
  it("acknowledges malformed payloads without claiming", async () => {
    const { deps, convexQueue } = createDeps();
    const handler = createQueueMessageHandler(deps);

    await expect(handler({ trackId: "nope" }, metadata())).resolves.toBeUndefined();
    await expect(handler(null, metadata())).resolves.toBeUndefined();
    expect(convexQueue.claimSpecific).not.toHaveBeenCalled();
  });

  it("acknowledges messages past the delivery limit without claiming", async () => {
    const { deps, convexQueue } = createDeps();
    const handler = createQueueMessageHandler(deps);

    await expect(handler(payload(), metadata(MAX_QUEUE_DELIVERY_COUNT + 1)))
      .resolves.toBeUndefined();
    expect(convexQueue.claimSpecific).not.toHaveBeenCalled();
  });

  it("acknowledges done and dead jobs", async () => {
    for (const status of ["done", "dead"] as const) {
      const { deps, convexQueue, processJob } = createDeps();
      convexQueue.claimSpecific.mockResolvedValue({ status });
      const handler = createQueueMessageHandler(deps);

      await expect(handler(payload(), metadata())).resolves.toBeUndefined();
      expect(convexQueue.claimSpecific).toHaveBeenCalledWith("soundcloud:42:essentia-dj-v1");
      expect(processJob).not.toHaveBeenCalled();
    }
  });

  it("retries waiting jobs aligned with the Convex retry time", async () => {
    const { deps, convexQueue, processJob } = createDeps();
    convexQueue.claimSpecific.mockResolvedValue({ status: "waiting", retryAt: 1_000_000 + 45_000 });
    const handler = createQueueMessageHandler(deps);

    await expect(handler(payload(), metadata())).rejects.toMatchObject({
      name: "QueueRetrySignal",
      afterSeconds: 45,
    });
    expect(processJob).not.toHaveBeenCalled();
  });

  it("acknowledges claimed jobs that complete or die", async () => {
    for (const outcome of [{ status: "completed" }, { status: "done" }, { status: "dead" }]) {
      const { deps, convexQueue, processJob } = createDeps();
      convexQueue.claimSpecific.mockResolvedValue({
        status: "claimed",
        job: { cacheKey: "soundcloud:42:essentia-dj-v1", leaseToken: "lease" },
      });
      processJob.mockResolvedValue(outcome);
      const handler = createQueueMessageHandler(deps);

      await expect(handler(payload(), metadata())).resolves.toBeUndefined();
      expect(processJob).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKey: "soundcloud:42:essentia-dj-v1" }),
      );
    }
  });

  it("retries claimed jobs whose outcome is waiting (deferred or retryable failure)", async () => {
    const { deps, convexQueue, processJob } = createDeps();
    convexQueue.claimSpecific.mockResolvedValue({
      status: "claimed",
      job: { cacheKey: "soundcloud:42:essentia-dj-v1", leaseToken: "lease" },
    });
    processJob.mockResolvedValue({ status: "waiting", retryAfterMs: 30_000 });
    const handler = createQueueMessageHandler(deps);

    await expect(handler(payload(), metadata())).rejects.toMatchObject({
      name: "QueueRetrySignal",
      afterSeconds: 30,
    });
  });

  it("backs off when the claim request itself fails", async () => {
    const { deps, convexQueue, processJob } = createDeps();
    convexQueue.claimSpecific.mockRejectedValue(new Error("convex unreachable"));
    const handler = createQueueMessageHandler(deps);

    await expect(handler(payload(), metadata(2))).rejects.toMatchObject({
      name: "QueueRetrySignal",
      afterSeconds: 60,
    });
    expect(processJob).not.toHaveBeenCalled();
  });
});

describe("createQueueRetryPolicy", () => {
  const base = metadata(1);

  it("maps QueueRetrySignal to its delay", () => {
    const policy = createQueueRetryPolicy();
    expect(policy(new QueueRetrySignal(120, "retry"), base)).toEqual({ afterSeconds: 120 });
  });

  it("backs off unexpected errors and acks poison messages", () => {
    const policy = createQueueRetryPolicy(3);
    const error = new Error("unexpected");
    expect(policy(error, base)).toEqual({ afterSeconds: 30 });
    expect(policy(error, metadata(3))).toEqual({ acknowledge: true });
  });
});
