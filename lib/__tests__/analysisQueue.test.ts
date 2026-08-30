import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const convex = vi.hoisted(() => ({ fetchMutation: vi.fn() }));
const queueSdk = vi.hoisted(() => {
  const state = {
    constructorArgs: [] as unknown[][],
    sendBatch: vi.fn(),
  };
  class QueueClient {
    experimental_sendBatch = state.sendBatch;
    constructor(...args: unknown[]) {
      state.constructorArgs.push(args);
    }
  }
  return { state, QueueClient };
});
const sentry = vi.hoisted(() => {
  const spans: Array<{
    options: Record<string, unknown>;
    end: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    spans,
    startSpan: vi.fn((_options: Record<string, unknown>, callback: (span: unknown) => unknown) =>
      callback({ setStatus: vi.fn() })),
    startInactiveSpan: vi.fn((options: Record<string, unknown>) => {
      const span = { options, end: vi.fn(), setStatus: vi.fn() };
      spans.push(span);
      return span;
    }),
    getTraceData: vi.fn(({ span }: { span: unknown }) => ({
      "sentry-trace": `trace-${spans.indexOf(span as (typeof spans)[number])}`,
      baggage: `baggage-${spans.indexOf(span as (typeof spans)[number])}`,
    })),
  };
});
vi.mock("convex/nextjs", () => convex);
vi.mock("@sentry/nextjs", () => sentry);
vi.mock("@vercel/queue", () => ({ QueueClient: queueSdk.QueueClient }));
vi.mock("../../convex/_generated/api", () => ({
  api: { trackAnalysis: { prepareForViewer: "prepareForViewer" } },
}));

import { enqueueTrackAnalysis, enqueueTrackAnalyses } from "../server/analysisQueue";
import { TRACK_ANALYSIS_VERSION } from "../trackAnalysis";

const originalEnv = { ...process.env };
const fetchMock = vi.fn();

function convexResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  queueSdk.state.sendBatch.mockReset();
  queueSdk.state.sendBatch.mockResolvedValue([]);
  process.env.DJ_ANALYSIS_QUEUE_ENABLED = "true";
  process.env.ANALYSIS_SERVICE_SECRET = "secret";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  convex.fetchMutation.mockReset();
  queueSdk.state.constructorArgs.length = 0;
  fetchMock.mockReset();
  sentry.spans.length = 0;
  process.env = { ...originalEnv };
});

describe("enqueueTrackAnalysis", () => {
  it("enqueues the job in Convex and publishes one idempotent queue message", async () => {
    fetchMock.mockResolvedValue(convexResponse({ enqueued: 1, cached: 0, existing: 0 }));

    await expect(enqueueTrackAnalysis(42, 100)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.convex.site/analysis/enqueue");
    expect(init.headers.authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body)).toMatchObject({
      trackIds: ["42"],
      analysisVersion: TRACK_ANALYSIS_VERSION,
      priority: 100,
      traceContexts: [expect.objectContaining({
        trackId: "42",
        messageId: `soundcloud:42:${TRACK_ANALYSIS_VERSION}`,
      })],
    });

    expect(queueSdk.state.constructorArgs[0][0]).toMatchObject({
      region: "iad1",
      deploymentId: null,
    });
    expect(queueSdk.state.sendBatch).toHaveBeenCalledOnce();
    const [topic, messages] = queueSdk.state.sendBatch.mock.calls[0];
    expect(topic).toBe("track-analysis");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      idempotencyKey: `soundcloud:42:${TRACK_ANALYSIS_VERSION}`,
      retentionSeconds: 86_400,
      payload: { trackId: "42", analysisVersion: TRACK_ANALYSIS_VERSION, priority: 100 },
    });

    expect(sentry.spans[0].setStatus).toHaveBeenCalledWith({ code: 1, message: "ok" });
    expect(sentry.spans[0].end).toHaveBeenCalledOnce();
  });

  it("deduplicates inputs and publishes one message per track", async () => {
    fetchMock.mockResolvedValue(convexResponse({ enqueued: 2, cached: 1, existing: 0 }));

    await expect(enqueueTrackAnalyses([42, 42, 43], 10)).resolves.toEqual({
      enqueued: 2, cached: 1, existing: 0,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).trackIds).toEqual(["42", "43"]);
    const [, messages] = queueSdk.state.sendBatch.mock.calls[0];
    expect(messages.map((message: { payload: { trackId: string } }) => message.payload.trackId))
      .toEqual(["42", "43"]);
  });

  it("preflights viewer identity and forwards requestedBy to Convex and the queue message", async () => {
    convex.fetchMutation.mockResolvedValue("viewer-id");
    fetchMock.mockResolvedValue(convexResponse({ enqueued: 1, cached: 0, existing: 0 }));

    await enqueueTrackAnalyses([42], 10, "convex-token");

    expect(convex.fetchMutation).toHaveBeenCalledWith(
      "prepareForViewer",
      {},
      { token: "convex-token" },
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requestedBy).toBe("viewer-id");
    const [, messages] = queueSdk.state.sendBatch.mock.calls[0];
    expect(messages[0].payload.requestedBy).toBe("viewer-id");
  });

  it("does nothing when analysis is disabled", async () => {
    process.env.DJ_ANALYSIS_QUEUE_ENABLED = "false";
    await expect(enqueueTrackAnalyses([42, 43])).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueSdk.state.sendBatch).not.toHaveBeenCalled();
  });

  it("does not publish queue messages when the Convex enqueue fails", async () => {
    fetchMock.mockResolvedValue(convexResponse({ error: "boom" }, 500));

    await expect(enqueueTrackAnalyses([42])).rejects.toThrow("Analysis enqueue failed (500)");
    expect(queueSdk.state.sendBatch).not.toHaveBeenCalled();
    expect(sentry.spans[0].setStatus).toHaveBeenCalledWith({ code: 2, message: "internal_error" });
    expect(sentry.spans[0].end).toHaveBeenCalledOnce();
  });

  it("fails when any queue message in the batch is rejected", async () => {
    fetchMock.mockResolvedValue(convexResponse({ enqueued: 2, cached: 0, existing: 0 }));
    queueSdk.state.sendBatch.mockResolvedValue([
      { status: "sent", messageId: "m1" },
      { status: "failed", statusCode: 400, error: "invalid topic", retryable: false },
    ]);

    await expect(enqueueTrackAnalyses([42, 43])).rejects.toThrow("Queue publish failed for 1/2");
    expect(sentry.spans[0].setStatus).toHaveBeenCalledWith({ code: 2, message: "internal_error" });
  });
});
