import { afterEach, describe, expect, it, vi } from "vitest";

const convex = vi.hoisted(() => ({ fetchMutation: vi.fn() }));
vi.mock("convex/nextjs", () => convex);
vi.mock("../../convex/_generated/api", () => ({
  api: { trackAnalysis: { enqueueForViewer: "enqueueForViewer" } },
}));

import { enqueueTrackAnalysis, enqueueTrackAnalyses } from "../server/analysisQueue";
import { TRACK_ANALYSIS_VERSION } from "../trackAnalysis";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  convex.fetchMutation.mockReset();
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
      body: JSON.stringify({
        trackIds: ["42"],
        priority: 100,
        analysisVersion: TRACK_ANALYSIS_VERSION,
      }),
    });
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
    }, { token: "convex-token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
