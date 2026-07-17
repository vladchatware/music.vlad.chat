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

describe("readAccessToken", () => {
  it("coalesces concurrent client-credentials requests", async () => {
    vi.stubEnv("CLIENT_ID", "client-id");
    vi.stubEnv("CLIENT_SECRET", "client-secret");
    vi.resetModules();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "access-token",
      expires_in: 3600,
    })));
    const { readAccessToken } = await import("./soundcloud");

    await expect(Promise.all([readAccessToken(), readAccessToken(), readAccessToken()]))
      .resolves.toEqual(["access-token", "access-token", "access-token"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("backs off after token endpoint rate limiting", async () => {
    vi.stubEnv("CLIENT_ID", "client-id");
    vi.stubEnv("CLIENT_SECRET", "client-secret");
    vi.resetModules();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 429 }),
    );
    const { readAccessToken } = await import("./soundcloud");

    await expect(readAccessToken()).rejects.toMatchObject({ status: 429, retryAfterMs: 60_000 });
    await expect(readAccessToken()).rejects.toMatchObject({ status: 429, retryAfterMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
});
