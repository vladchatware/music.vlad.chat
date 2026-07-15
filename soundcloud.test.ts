import { afterEach, describe, expect, it, vi } from "vitest";

import { allLikes, resolveTrackStreamUrl } from "./soundcloud";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resolveTrackStreamUrl", () => {
  it("bounds a stalled CDN redirect lookup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        http_mp3_128_url: "https://api.soundcloud.test/stream",
      }), { status: 200 }))
      .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }));

    const pending = resolveTrackStreamUrl(42, "token", 10);

    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: expect.objectContaining({ Range: "bytes=0-0" }),
      redirect: "follow",
    });
  });
});

describe("allLikes", () => {
  it("follows linked-partitioning pages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        collection: [{ id: 1 }],
        next_href: "https://api.soundcloud.com/likes-next",
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        collection: [{ id: 2 }],
        next_href: null,
      })));

    await expect(allLikes("7", "token")).resolves.toMatchObject([{ id: 1 }, { id: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0].toString()).toBe("https://api.soundcloud.com/likes-next");
  });
});
