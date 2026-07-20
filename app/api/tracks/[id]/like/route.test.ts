import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/soundcloud", () => ({
  refreshUserToken: vi.fn(),
  setTrackLiked: vi.fn(),
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
import { refreshUserToken, setTrackLiked } from "@/soundcloud";
import { DELETE, POST } from "./route";

const context = { params: Promise.resolve({ id: "42" }) };

describe("/api/tracks/[id]/like", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(convexAuthNextjsToken).mockResolvedValue("convex-token" as never);
    vi.mocked(fetchQuery).mockResolvedValue({
      accessToken: "soundcloud-token",
      refreshToken: "soundcloud-refresh",
    } as never);
  });

  it("requires authentication", async () => {
    vi.mocked(convexAuthNextjsToken).mockResolvedValue(null as never);
    const response = await POST(new Request("http://localhost"), context);
    expect(response.status).toBe(401);
    expect(setTrackLiked).not.toHaveBeenCalled();
  });

  it("likes and unlikes current track", async () => {
    const liked = await POST(new Request("http://localhost"), context);
    const unliked = await DELETE(new Request("http://localhost"), context);

    expect(liked.status).toBe(200);
    expect(unliked.status).toBe(200);
    expect(setTrackLiked).toHaveBeenNthCalledWith(1, "42", true, "soundcloud-token");
    expect(setTrackLiked).toHaveBeenNthCalledWith(2, "42", false, "soundcloud-token");
  });

  it("refreshes an expired SoundCloud token and retries", async () => {
    vi.mocked(setTrackLiked)
      .mockRejectedValueOnce(Object.assign(new Error("expired"), { status: 401 }))
      .mockResolvedValueOnce(undefined);
    vi.mocked(refreshUserToken).mockResolvedValue({
      accessToken: "fresh-token",
      refreshToken: "fresh-refresh",
    });

    const response = await POST(new Request("http://localhost"), context);

    expect(response.status).toBe(200);
    expect(fetchMutation).toHaveBeenCalledWith(
      "updateSoundcloudTokens",
      { accessToken: "fresh-token", refreshToken: "fresh-refresh" },
      { token: "convex-token" },
    );
    expect(setTrackLiked).toHaveBeenLastCalledWith("42", true, "fresh-token");
  });
});
