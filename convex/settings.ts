import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getSoundcloudToken = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("settings").first();
    return (doc as any)?.soundcloudRefreshToken ?? null;
  },
});

export const setSoundcloudToken = mutation({
  args: { refreshToken: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("settings").first();
    if (existing) {
      await ctx.db.patch(existing._id, { soundcloudRefreshToken: args.refreshToken });
    } else {
      await ctx.db.insert("settings", { soundcloudRefreshToken: args.refreshToken });
    }
  },
});
