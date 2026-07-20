import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  continueTrace: vi.fn((_context: unknown, callback: () => unknown) => callback()),
  spans: [] as Array<{ setStatus: ReturnType<typeof vi.fn> }>,
  startSpan: vi.fn((_options: unknown, callback: (span: unknown) => unknown) => {
    const span = { setStatus: vi.fn() };
    sentry.spans.push(span);
    return callback(span);
  }),
}));

vi.mock("@sentry/node", () => sentry);

import { processWithQueueTrace } from "./queueTracing";

const job = {
  cacheKey: "soundcloud:42:essentia-dj-v7",
  sourceTrackId: "42",
  analysisVersion: "essentia-dj-v7",
  attempt: 2,
  leaseToken: "lease",
  createdAt: 1_000,
  sentAt: 1_250,
  messageId: "soundcloud:42:essentia-dj-v7",
  messageBodySize: 128,
  sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
  sentryBaggage: "sentry-environment=preview",
};

beforeEach(() => {
  sentry.continueTrace.mockClear();
  sentry.startSpan.mockClear();
  sentry.spans.length = 0;
});

describe("processWithQueueTrace", () => {
  it("continues the producer trace and records queue processing attributes", async () => {
    const processor = vi.fn().mockResolvedValue("complete");

    await expect(processWithQueueTrace(job, processor, 2_000)).resolves.toBe("complete");

    expect(sentry.continueTrace).toHaveBeenCalledWith({
      sentryTrace: job.sentryTrace,
      baggage: job.sentryBaggage,
    }, expect.any(Function));
    expect(sentry.startSpan).toHaveBeenCalledWith({
      name: "track-analysis process",
      op: "queue.process",
      attributes: {
        "messaging.destination.name": "track-analysis",
        "messaging.message.id": job.messageId,
        "messaging.message.body.size": 128,
        "messaging.message.retry.count": 1,
        "messaging.message.receive.latency": 750,
      },
    }, expect.any(Function));
    expect(processor).toHaveBeenCalledOnce();
    expect(sentry.startSpan).toHaveBeenCalledWith({
      name: "track-analysis consumer",
    }, expect.any(Function));
    expect(sentry.spans[0].setStatus).toHaveBeenCalledWith({ code: 1, message: "ok" });
    expect(sentry.spans[1].setStatus).toHaveBeenCalledWith({ code: 1, message: "ok" });
  });

  it("marks failed processing spans as errors", async () => {
    const error = new Error("analysis failed");

    await expect(processWithQueueTrace(job, async () => { throw error; }, 2_000))
      .rejects.toThrow("analysis failed");

    expect(sentry.spans[0].setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "internal_error",
    });
    expect(sentry.spans[1].setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "internal_error",
    });
  });
});
