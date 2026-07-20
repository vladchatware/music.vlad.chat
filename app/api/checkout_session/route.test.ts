import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { count: vi.fn(), distribution: vi.fn() },
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn(),
  fetchMutation: vi.fn(),
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { users: { viewer: "viewer", connect: "connect" } },
}));

vi.mock("../../../lib/stripe", () => ({
  stripe: {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  },
}));

import { fetchQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { stripe } from "../../../lib/stripe";
import { POST } from "./route";

describe("POST /api/checkout_session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://music.example";
    vi.mocked(convexAuthNextjsToken).mockResolvedValue("token");
  });

  it("creates fixed-price checkout using server-authored credit metadata", async () => {
    vi.mocked(fetchQuery).mockResolvedValue({
      _id: "user_1",
      stripeId: "cus_1",
      email: "listener@example.com",
      isAnonymous: false,
    } as never);
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
      id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/cs_1",
    } as never);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      customer: "cus_1",
      line_items: [expect.objectContaining({
        price_data: expect.objectContaining({ unit_amount: 500, currency: "usd" }),
      })],
      metadata: { userId: "user_1", tokens: "16666666" },
      success_url: "https://music.example?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://music.example?canceled=true",
    }));
  });

  it("rejects unauthenticated checkout", async () => {
    vi.mocked(fetchQuery).mockResolvedValue(null as never);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});
