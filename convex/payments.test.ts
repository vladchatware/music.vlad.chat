/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

describe("payment credit ledger", () => {
  it("credits a checkout session exactly once across webhook redelivery", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { tokens: 100 }));

    await expect(t.mutation(internal.users.applyPayment, {
      stripeEventId: "evt_1",
      checkoutSessionId: "cs_1",
      userId,
      tokens: 1_000,
      amountTotal: 500,
      currency: "usd",
    })).resolves.toMatchObject({ applied: true, userId });

    await expect(t.mutation(internal.users.applyPayment, {
      stripeEventId: "evt_redelivery",
      checkoutSessionId: "cs_1",
      userId,
      tokens: 1_000,
      amountTotal: 500,
      currency: "usd",
    })).resolves.toMatchObject({ applied: false, userId });

    const state = await t.run(async (ctx) => ({
      user: await ctx.db.get("users", userId),
      payments: await ctx.db.query("payments").collect(),
    }));
    expect(state.user?.tokens).toBe(1_100);
    expect(state.payments).toHaveLength(1);
  });

  it("rejects invalid token credits", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { tokens: 100 }));

    await expect(t.mutation(internal.users.applyPayment, {
      stripeEventId: "evt_bad",
      checkoutSessionId: "cs_bad",
      userId,
      tokens: 0,
    })).rejects.toThrow("Invalid token credit");
  });
});
