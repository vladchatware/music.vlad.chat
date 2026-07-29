import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/soundcloud", () => ({
  meLibrary: vi.fn(),
  refreshUserToken: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    users: {
      soundcloudTokens: "soundcloudTokens",
      updateSoundcloudTokens: "updateSoundcloudTokens",
    },
  },
}));

import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";

import { meLibrary, refreshUserToken } from "@/soundcloud";

import { GET } from "./route";

const library = {
  profile: { id: 7, username: "listener" },
  recentlyPlayed: [{ id: 1 }],
  likes: [{ id: 2 }],
  playlists: [{ id: 3 }],
};

describe("/api/me/library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(convexAuthNextjsToken).mockResolvedValue("convex-token" as never);
    vi.mocked(fetchQuery).mockResolvedValue({
      accessToken: "soundcloud-token",
      refreshToken: "soundcloud-refresh",
    } as never);
    vi.mocked(meLibrary).mockResolvedValue(library as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires authentication", async () => {
    vi.mocked(convexAuthNextjsToken).mockResolvedValue(null as never);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(meLibrary).not.toHaveBeenCalled();
  });

  it("returns the connected user's SoundCloud library", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(library);
    expect(meLibrary).toHaveBeenCalledWith("soundcloud-token");
  });

  it("uses configured service user without OAuth in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANALYSIS_SERVICE_SECRET", "analysis-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://convex.example/api");
    vi.stubEnv("SOUNDCLOUD_USER_ID", "service-user");
    vi.mocked(convexAuthNextjsToken).mockResolvedValue(null as never);
    const credentialFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accessToken: "service-access",
      refreshToken: "service-refresh",
    }), { status: 200 }));
    vi.stubGlobal("fetch", credentialFetch);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ source: "service_user" });
    expect(credentialFetch).toHaveBeenCalledWith(
      "https://convex.example/soundcloud/service-credentials",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ soundcloudUserId: "service-user" }),
        headers: expect.objectContaining({
          authorization: "Bearer analysis-secret",
        }),
      }),
    );
    expect(meLibrary).toHaveBeenCalledWith("service-access");
  });

  it("refreshes the service user's expired token", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANALYSIS_SERVICE_SECRET", "analysis-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://convex.example");
    vi.mocked(convexAuthNextjsToken).mockResolvedValue(null as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accessToken: "expired-service-access",
      refreshToken: "service-refresh",
    }), { status: 200 })));
    vi.mocked(meLibrary)
      .mockRejectedValueOnce(Object.assign(new Error("expired"), { status: 401 }))
      .mockResolvedValueOnce(library as never);
    vi.mocked(refreshUserToken).mockResolvedValue({
      accessToken: "fresh-service-access",
      refreshToken: "fresh-service-refresh",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(refreshUserToken).toHaveBeenCalledWith("service-refresh");
    expect(meLibrary).toHaveBeenLastCalledWith("fresh-service-access");
  });

  it("refreshes an expired SoundCloud token and retries", async () => {
    vi.mocked(meLibrary)
      .mockRejectedValueOnce(Object.assign(new Error("expired"), { status: 401 }))
      .mockResolvedValueOnce(library as never);
    vi.mocked(refreshUserToken).mockResolvedValue({
      accessToken: "fresh-token",
      refreshToken: "fresh-refresh",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(fetchMutation).toHaveBeenCalledWith(
      "updateSoundcloudTokens",
      { accessToken: "fresh-token", refreshToken: "fresh-refresh" },
      { token: "convex-token" },
    );
    expect(meLibrary).toHaveBeenLastCalledWith("fresh-token");
  });
});
