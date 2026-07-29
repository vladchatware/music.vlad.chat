import { afterEach, describe, expect, it, vi } from "vitest";

const analysisQueue = vi.hoisted(() => ({ enqueueTrackAnalyses: vi.fn() }));
vi.mock("@/lib/server/analysisQueue", () => analysisQueue);

import { POST } from "./route";

const originalSecret = process.env.ANALYSIS_SERVICE_SECRET;

afterEach(() => {
  analysisQueue.enqueueTrackAnalyses.mockReset();
  if (originalSecret === undefined) delete process.env.ANALYSIS_SERVICE_SECRET;
  else process.env.ANALYSIS_SERVICE_SECRET = originalSecret;
});

function request(body: unknown, secret = "test-secret") {
  return new Request("https://music.test/api/analysis/enqueue", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analysis/enqueue", () => {
  it("requires service authorization", async () => {
    process.env.ANALYSIS_SERVICE_SECRET = "test-secret";
    const response = await POST(request({ trackIds: ["42"] }, "wrong"));
    expect(response.status).toBe(401);
    expect(analysisQueue.enqueueTrackAnalyses).not.toHaveBeenCalled();
  });

  it("rejects malformed track IDs", async () => {
    process.env.ANALYSIS_SERVICE_SECRET = "test-secret";
    const response = await POST(request({ trackIds: "not-an-array" }));
    expect(response.status).toBe(400);
  });

  it("enqueues through durable workflow publisher", async () => {
    process.env.ANALYSIS_SERVICE_SECRET = "test-secret";
    analysisQueue.enqueueTrackAnalyses.mockResolvedValue({
      enqueued: 2,
      cached: 0,
      existing: 0,
    });

    const response = await POST(request({
      trackIds: [42, "43"],
      priority: 100,
      force: true,
      soundcloudUserId: "listener",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enqueued: 2, cached: 0, existing: 0 });
    expect(analysisQueue.enqueueTrackAnalyses).toHaveBeenCalledWith(
      ["42", "43"],
      100,
      undefined,
      true,
      "listener",
    );
  });
});
