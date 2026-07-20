import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("../../../../soundcloud", () => ({
  track: vi.fn(),
  refreshUserToken: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn(),
  fetchMutation: vi.fn(),
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(),
}));

vi.mock("../../../../convex/_generated/api", () => ({
  api: { users: { soundcloudTokens: "soundcloudTokens" } },
}));

vi.mock("@/lib/server/analysisQueue", () => ({
  enqueueTrackAnalysis: vi.fn(),
}));

import { GET } from "./route";
import { track } from "../../../../soundcloud";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

describe("GET /api/tracks/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(convexAuthNextjsToken).mockResolvedValue(null as never);
  });

  it("returns 429 when SoundCloud rate limits token acquisition", async () => {
    vi.mocked(track).mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 }));

    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "1458789469" }),
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "SoundCloud rate limit reached. Try again later.",
      code: "RATE_LIMITED",
    });
  });

  it("forwards SoundCloud retry delay", async () => {
    vi.mocked(track).mockRejectedValue(
      Object.assign(new Error("rate limited"), { status: 429, retryAfterMs: 2_500 }),
    );

    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "1458789469" }),
    });

    expect(response.headers.get("retry-after")).toBe("3");
  });
});
