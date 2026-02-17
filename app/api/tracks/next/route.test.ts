import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../soundcloud", () => ({
  likes: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn(),
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(),
}));

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    users: {
      soundcloudToken: "soundcloudToken",
    },
  },
}));

import { likes } from "../../../../soundcloud";
import { GET } from "./route";

describe("GET /api/tracks/next", () => {
  const originalUserId = process.env.SOUNDCLOUD_USER_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOUNDCLOUD_USER_ID = "23625673";
  });

  it("returns a playable non-excluded candidate", async () => {
    vi.mocked(likes).mockResolvedValue([
      { id: 11, streamable: true, duration: 20_000 },
      { id: 12, streamable: false, duration: 120_000 },
      { id: 13, streamable: true, duration: 120_000, title: "keep" },
    ] as any);

    const res = await GET(new Request("http://localhost/api/tracks/next?exclude=10,14") as any);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      track: { id: 13 },
    });
  });

  it("returns 404 when no playable candidates remain", async () => {
    vi.mocked(likes).mockResolvedValue([{ id: 21, streamable: false, duration: 200_000 }] as any);

    const res = await GET(new Request("http://localhost/api/tracks/next") as any);
    expect(res.status).toBe(404);
  });

  it("returns 500 if SOUNDCLOUD_USER_ID is missing", async () => {
    delete process.env.SOUNDCLOUD_USER_ID;
    vi.mocked(likes).mockResolvedValue([] as any);

    const res = await GET(new Request("http://localhost/api/tracks/next") as any);
    expect(res.status).toBe(500);
  });

  afterAll(() => {
    process.env.SOUNDCLOUD_USER_ID = originalUserId;
  });
});
