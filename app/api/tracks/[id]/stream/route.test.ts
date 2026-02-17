import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../soundcloud", () => ({
  resolveTrackStreamUrl: vi.fn(),
  isPreviewStreamUrl: vi.fn().mockReturnValue(false),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn(),
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(),
}));

vi.mock("../../../../../convex/_generated/api", () => ({
  api: {
    users: {
      soundcloudToken: "soundcloudToken",
    },
  },
}));

import { GET } from "./route";
import { isPreviewStreamUrl, resolveTrackStreamUrl } from "../../../../../soundcloud";
import { fetchQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

describe("GET /api/tracks/[id]/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when track id is missing", async () => {
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({}) as any,
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Track ID is required" });
  });

  it("returns 307 redirect with location and cache headers", async () => {
    vi.mocked(convexAuthNextjsToken).mockResolvedValue("token-1" as any);
    vi.mocked(fetchQuery).mockResolvedValue("user-sc-token" as any);
    vi.mocked(resolveTrackStreamUrl).mockResolvedValue(
      "https://cdn.soundcloud.com/stream-file.m4a",
    );

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "123" }) as any,
    });

    expect(fetchQuery).toHaveBeenCalledWith(
      "soundcloudToken",
      {},
      { token: "token-1" },
    );
    expect(resolveTrackStreamUrl).toHaveBeenCalledWith("123", "user-sc-token");
    expect(isPreviewStreamUrl).toHaveBeenCalledWith("https://cdn.soundcloud.com/stream-file.m4a");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://cdn.soundcloud.com/stream-file.m4a");
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
    expect(res.headers.get("x-mp-stream-preview")).toBe("0");
  });

  it("falls back to server credentials when auth lookup fails", async () => {
    vi.mocked(convexAuthNextjsToken).mockRejectedValue(new Error("unauthenticated"));
    vi.mocked(resolveTrackStreamUrl).mockResolvedValue("https://cdn.soundcloud.com/fallback.m4a");

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "777" }) as any,
    });

    expect(fetchQuery).not.toHaveBeenCalled();
    expect(resolveTrackStreamUrl).toHaveBeenCalledWith("777", undefined);
    expect(res.status).toBe(307);
  });

  it("marks preview redirects in response headers", async () => {
    vi.mocked(convexAuthNextjsToken).mockResolvedValue(null as any);
    vi.mocked(resolveTrackStreamUrl).mockResolvedValue(
      "https://cf-preview-media.sndcdn.com/preview/0/30/abc.128.mp3",
    );
    vi.mocked(isPreviewStreamUrl).mockReturnValue(true);

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "321" }) as any,
    });

    expect(res.status).toBe(307);
    expect(res.headers.get("x-mp-stream-preview")).toBe("1");
  });

  it("returns 502 when stream URL resolution fails", async () => {
    vi.mocked(convexAuthNextjsToken).mockResolvedValue(null as any);
    vi.mocked(resolveTrackStreamUrl).mockRejectedValue(new Error("resolution failed"));

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "999" }) as any,
    });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Failed to resolve track stream URL",
    });
  });
});
