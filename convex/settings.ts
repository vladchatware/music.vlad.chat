import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getRefreshToken = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("settings").first();
    return (doc as any)?.refreshToken ?? null;
  },
});

export const setRefreshToken = mutation({
  args: { refreshToken: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("settings").first();
    if (existing) {
      await ctx.db.patch(existing._id, { refreshToken: args.refreshToken });
    } else {
      await ctx.db.insert("settings", { refreshToken: args.refreshToken });
    }
  },
});
