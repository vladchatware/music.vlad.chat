import { afterEach, describe, expect, it, vi } from "vitest";

const convex = vi.hoisted(() => ({ fetchMutation: vi.fn() }));
const workflow = vi.hoisted(() => ({ start: vi.fn() }));
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
vi.mock("workflow/api", () => workflow);
vi.mock("../../convex/_generated/api", () => ({
  api: { trackAnalysis: { enqueueForViewer: "enqueueForViewer" } },
}));

import { enqueueTrackAnalysis, enqueueTrackAnalyses } from "../server/analysisQueue";
import { TRACK_ANALYSIS_VERSION } from "../trackAnalysis";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  convex.fetchMutation.mockReset();
  workflow.start.mockReset();
  workflow.start.mockResolvedValue({ runId: "run-id" });
  sentry.spans.length = 0;
  sentry.startSpan.mockClear();
  sentry.startInactiveSpan.mockClear();
  sentry.getTraceData.mockClear();
  process.env = { ...originalEnv };
});

describe("enqueueTrackAnalysis", () => {
  it("targets Convex site root even when configured URL contains an api suffix", async () => {
    process.env.DJ_ANALYSIS_QUEUE_ENABLED = "true";
    process.env.CONVEX_SITE_URL = "https://fixture.convex.site/api/";
    process.env.ANALYSIS_SERVICE_SECRET = "secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"enqueued":1,"cached":0,"existing":0}', { status: 200 }),
    );

    await expect(enqueueTrackAnalysis(42, 100)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://fixture.convex.site/analysis/enqueue");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ authorization: "Bearer secret" }),
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      trackIds: ["42"],
      priority: 100,
      analysisVersion: TRACK_ANALYSIS_VERSION,
      traceContexts: [{
        trackId: "42",
        sentryTrace: "trace-0",
        sentryBaggage: "baggage-0",
        messageId: `soundcloud:42:${TRACK_ANALYSIS_VERSION}`,
        sentAt: expect.any(Number),
        messageBodySize: expect.any(Number),
      }],
    });
    expect(sentry.spans[0].options).toMatchObject({
      name: "track-analysis publish",
      op: "queue.publish",
      attributes: {
        "messaging.destination.name": "track-analysis",
        "messaging.message.id": `soundcloud:42:${TRACK_ANALYSIS_VERSION}`,
        "messaging.message.body.size": expect.any(Number),
      },
    });
    expect(sentry.spans[0].setStatus).toHaveBeenCalledWith({ code: 1, message: "ok" });
    expect(sentry.spans[0].end).toHaveBeenCalledOnce();
    expect(sentry.startSpan).toHaveBeenCalledWith({ name: "track-analysis enqueue" }, expect.any(Function));
    expect(workflow.start).toHaveBeenCalledOnce();
  });

  it("deduplicates and batches candidate tracks", async () => {
    process.env.DJ_ANALYSIS_QUEUE_ENABLED = "true";
    process.env.CONVEX_SITE_URL = "https://fixture.convex.site";
    process.env.ANALYSIS_SERVICE_SECRET = "secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"enqueued":2,"cached":1,"existing":0}', { status: 200 }),
    );

    await expect(enqueueTrackAnalyses([42, 42, 43, 44], 10)).resolves.toEqual({
      enqueued: 2, cached: 1, existing: 0,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      trackIds: ["42", "43", "44"], priority: 10,
    });
    expect(workflow.start).toHaveBeenCalledTimes(3);
  });

  it("uses viewer-authenticated mutation when a Convex token is available", async () => {
    process.env.DJ_ANALYSIS_QUEUE_ENABLED = "true";
    delete process.env.CONVEX_SITE_URL;
    delete process.env.ANALYSIS_SERVICE_SECRET;
    convex.fetchMutation.mockResolvedValue({ enqueued: 1, cached: 0, existing: 0 });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(enqueueTrackAnalyses([42], 10, "convex-token")).resolves.toEqual({
      enqueued: 1, cached: 0, existing: 0,
    });
    expect(convex.fetchMutation).toHaveBeenCalledWith("enqueueForViewer", {
      trackIds: ["42"],
      priority: 10,
      analysisVersion: TRACK_ANALYSIS_VERSION,
      traceContexts: [{
        trackId: "42",
        sentryTrace: "trace-0",
        sentryBaggage: "baggage-0",
        messageId: `soundcloud:42:${TRACK_ANALYSIS_VERSION}`,
        sentAt: expect.any(Number),
        messageBodySize: expect.any(Number),
      }],
    }, { token: "convex-token" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(workflow.start).toHaveBeenCalledOnce();
  });

  it("does not start workflows when every track is already cached", async () => {
    process.env.DJ_ANALYSIS_QUEUE_ENABLED = "true";
    process.env.CONVEX_SITE_URL = "https://fixture.convex.site";
    process.env.ANALYSIS_SERVICE_SECRET = "secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"enqueued":0,"cached":2,"existing":0}', { status: 200 }),
    );

    await expect(enqueueTrackAnalyses([42, 43])).resolves.toEqual({
      enqueued: 0, cached: 2, existing: 0,
    });
    expect(workflow.start).not.toHaveBeenCalled();
  });

});
