import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTrack, streamTrack } from "../soundcloud";

describe("SoundCloud client routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps track metadata and streams on the current browser origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ id: 2260180544 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchTrack(2260180544);

    expect(fetchMock).toHaveBeenCalledWith("/api/tracks/2260180544");
    expect(streamTrack(2260180544)).toBe("/api/tracks/2260180544/stream");
  });
});
