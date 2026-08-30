import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../soundcloud", () => ({
  refreshUserToken: vi.fn(),
  resolveTrackStreamUrl: vi.fn(),
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
import { resolveStreamWithTimeout } from "./streamResolver";
import { refreshUserToken, resolveTrackStreamUrl } from "../../../../../soundcloud";
import { fetchQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

describe("GET /api/tracks/[id]/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://cdn.soundcloud.com/stream-file.m4a");
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
  });

  it("falls back to server credentials when auth lookup fails", async () => {
    vi.mocked(convexAuthNextjsToken).mockRejectedValue(new Error("unauthenticated"));
    vi.mocked(resolveTrackStreamUrl).mockResolvedValue("https://cdn.soundcloud.com/fallback.m4a");

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "777" }) as any,
    });

    expect(fetchQuery).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
  });

  it("rotates the service-user token via the central endpoint for anonymous playback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANALYSIS_SERVICE_SECRET", "analysis-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://convex.example/api");
    vi.stubEnv("SOUNDCLOUD_USER_ID", "service-user");
    const credentialFetch = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ accessToken: "stale-service-access" }),
        { status: 200 },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ accessToken: "rotated-service-access" }),
        { status: 200 },
      ));
    vi.stubGlobal("fetch", credentialFetch);
    vi.mocked(convexAuthNextjsToken).mockResolvedValue(null as never);
    vi.mocked(resolveTrackStreamUrl)
      .mockRejectedValueOnce(Object.assign(new Error("token error"), { status: 401 }))
      .mockResolvedValueOnce("https://cdn.soundcloud.com/rotated.m4a");

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "888" }) as never,
    });

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://cdn.soundcloud.com/rotated.m4a");
    expect(credentialFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(credentialFetch.mock.calls[1][1] && (credentialFetch.mock.calls[1][1] as RequestInit).body)))
      .toMatchObject({ rotate: true });
    expect(resolveTrackStreamUrl).toHaveBeenLastCalledWith("888", "rotated-service-access");
    expect(refreshUserToken).not.toHaveBeenCalled();
  });

  it("uses service-user credentials anonymously outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANALYSIS_SERVICE_SECRET", "analysis-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://convex.example");
    vi.stubEnv("SOUNDCLOUD_USER_ID", "service-user");
    vi.mocked(convexAuthNextjsToken).mockResolvedValue(null as never);
    const credentialFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accessToken: "service-access",
      refreshToken: "service-refresh",
    }), { status: 200 }));
    vi.stubGlobal("fetch", credentialFetch);
    vi.mocked(resolveTrackStreamUrl).mockResolvedValue(
      "https://cdn.soundcloud.com/service-user.m4a",
    );

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "889" }) as never,
    });

    expect(res.status).toBe(307);
    expect(credentialFetch).toHaveBeenCalledOnce();
    expect(resolveTrackStreamUrl).toHaveBeenCalledWith("889", "service-access");
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

  it("bounds the complete auth and stream resolution chain", async () => {
    vi.mocked(resolveTrackStreamUrl).mockImplementation(() => new Promise(() => {}));

    await expect(resolveStreamWithTimeout("999", undefined, 10)).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });
});
