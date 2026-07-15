import { describe, expect, it, vi } from "vitest";

import { createDJAgentTools, createTrackAnalysisReader } from "../server/djAgentTools";

describe("createTrackAnalysisReader", () => {
  it("caches duplicate single-track lookups for one request", async () => {
    const load = vi.fn(async () => null);
    const read = createTrackAnalysisReader(load);

    await read(42, "summary");
    await read(42, "timing");

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith("42");
  });

  it("returns structured rate-limit and unavailable results", async () => {
    const limited = createTrackAnalysisReader(async () => {
      throw new Error("429 rate limit");
    });
    const unavailable = createTrackAnalysisReader(async () => {
      throw new Error("network down");
    });

    await expect(limited(1, "summary")).resolves.toEqual({
      status: "rate_limited",
      trackId: "1",
    });
    await expect(unavailable(2, "summary")).resolves.toEqual({
      status: "unavailable",
      trackId: "2",
    });
  });
});

describe("schedule_track_analysis", () => {
  it("queues unique candidates at background priority without waiting for results", async () => {
    const schedule = vi.fn(async () => ({ enqueued: 2, cached: 1, existing: 0 }));
    const tool = createDJAgentTools(schedule).schedule_track_analysis;
    await expect(tool.execute({ ids: [11, 11, 12, 13] })).resolves.toMatchObject({
      status: "scheduled",
      trackIds: [11, 12, 13],
      enqueued: 2,
      cached: 1,
    });
    expect(schedule).toHaveBeenCalledWith([11, 12, 13], 10);
  });
});
