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
  api: { trackAnalysis: { prepareForViewer: "prepareForViewer" } },
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
  process.env = { ...originalEnv };
});

describe("enqueueTrackAnalysis", () => {
  it("starts a workflow that owns the enqueue operation", async () => {
    process.env.DJ_ANALYSIS_QUEUE_ENABLED = "true";
    process.env.ANALYSIS_SERVICE_SECRET = "secret";

    await expect(enqueueTrackAnalysis(42, 100)).resolves.toBe(true);
    expect(workflow.start).toHaveBeenCalledWith(expect.any(Function), [{
      trackId: "42",
      analysisVersion: TRACK_ANALYSIS_VERSION,
      priority: 100,
      force: undefined,
      soundcloudUserId: undefined,
      requestedBy: undefined,
      traceContext: expect.objectContaining({
        trackId: "42",
        messageId: `soundcloud:42:${TRACK_ANALYSIS_VERSION}`,
      }),
    }]);
    expect(sentry.spans[0].setStatus).toHaveBeenCalledWith({ code: 1, message: "ok" });
    expect(sentry.spans[0].end).toHaveBeenCalledOnce();
  });

  it("deduplicates inputs and starts one workflow per track", async () => {
    process.env.DJ_ANALYSIS_QUEUE_ENABLED = "true";
    process.env.ANALYSIS_SERVICE_SECRET = "secret";

    await expect(enqueueTrackAnalyses([42, 42, 43, 44], 10)).resolves.toEqual({
      enqueued: 3, cached: 0, existing: 0,
    });
    expect(workflow.start).toHaveBeenCalledTimes(3);
  });

  it("preflights viewer identity without storing the auth token in workflow state", async () => {
    process.env.DJ_ANALYSIS_QUEUE_ENABLED = "true";
    process.env.ANALYSIS_SERVICE_SECRET = "secret";
    convex.fetchMutation.mockResolvedValue("viewer-id");

    await enqueueTrackAnalyses([42], 10, "convex-token");

    expect(convex.fetchMutation).toHaveBeenCalledWith(
      "prepareForViewer",
      {},
      { token: "convex-token" },
    );
    expect(workflow.start).toHaveBeenCalledWith(expect.any(Function), [
      expect.objectContaining({ requestedBy: "viewer-id" }),
    ]);
  });

  it("does nothing when analysis is disabled", async () => {
    process.env.DJ_ANALYSIS_QUEUE_ENABLED = "false";
    await expect(enqueueTrackAnalyses([42, 43])).resolves.toBeNull();
    expect(workflow.start).not.toHaveBeenCalled();
  });
});
