import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    users: { viewer: "viewer" },
    aiChatSessions: { listMine: "listMine" },
  },
}));

vi.mock("./MeLibrary", () => ({
  default: () => null,
}));

import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";

import MePage from "./page";

describe("MePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(convexAuthNextjsToken).mockResolvedValue("stale-token" as never);
  });

  it("redirects when the authenticated viewer lookup rejects", async () => {
    vi.mocked(fetchQuery).mockRejectedValue(new Error("invalid token"));

    await expect(MePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/dashboard?returnTo=/me");
  });
});
