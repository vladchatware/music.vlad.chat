import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId !== null ? ctx.db.get(userId) : null;
  },
});

export const soundcloudToken = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    return user.soundcloudAccessToken ?? null;
  },
});

export const soundcloudTokens = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      accessToken: user.soundcloudAccessToken ?? null,
      refreshToken: user.soundcloudRefreshToken ?? null,
    };
  },
});

export const updateSoundcloudTokens = mutation({
  args: {
    accessToken: v.string(),
    refreshToken: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error('Not authenticated');
    await ctx.db.patch(userId, {
      soundcloudAccessToken: args.accessToken,
      soundcloudRefreshToken: args.refreshToken,
    });
  },
});

export const connect = mutation({
  args: { stripeId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new ConvexError("Authentication required")
    const user = await ctx.db.get("users", userId)
    if (!user) throw new ConvexError("User not found")
    if (user.stripeId === args.stripeId) return null
    if (user.stripeId) throw new ConvexError("Stripe customer already connected")
    const claimed = await ctx.db.query("users")
      .withIndex("stripeId", (q) => q.eq("stripeId", args.stripeId))
      .first()
    if (claimed) throw new ConvexError("Stripe customer already connected")
    await ctx.db.patch("users", userId, { stripeId: args.stripeId })
    return null
  }
})

export const messages = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    const user = await ctx.db.get(userId)
    if (user.trialMessages === 0) return
    return ctx.db.patch(userId, { trialMessages: user.trialMessages - 1 })
  }
})

export const usage = mutation({
  args: {
    model: v.string(),
    provider: v.string(),
    usage: v.object({
      totalTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      cachedInputTokens: v.optional(v.number()),
    })
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const user = await ctx.db.get(userId)

    if (user.isAnonymous && user.trialMessages > 0) {
      await ctx.db.patch(userId, { trialMessages: user.trialMessages - 1 })
    } else {
      const trialTokens = user.trialTokens - args.usage.totalTokens

      if (trialTokens <= 0) {
        const tokens = user.tokens - Math.abs(trialTokens)
        await ctx.db.patch(userId, { trialTokens: 0, tokens })
      } else {
        await ctx.db.patch(userId, { trialTokens })
      }
    }

    return ctx.db.insert('usage', {
      ...args,
      userId
    })
  },
})

export const resetMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = ((await ctx.db.query('users').collect()))
    for (const user of users) {
      await ctx.db.patch(user._id, { trialMessages: 10 })
    }
  }
})

export const resetTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = ((await ctx.db.query('users').collect()))
    for (const user of users) {
      await ctx.db.patch(user._id, { trialTokens: 16000000 })
    }
  }
})

export const applyPayment = internalMutation({
  args: {
    stripeEventId: v.string(),
    checkoutSessionId: v.string(),
    tokens: v.number(),
    userId: v.id("users"),
    amountTotal: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  returns: v.object({ applied: v.boolean(), userId: v.id("users") }),
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db.query("payments")
      .withIndex("by_stripe_event", (q) => q.eq("stripeEventId", args.stripeEventId))
      .first()
    const existingSession = await ctx.db.query("payments")
      .withIndex("by_checkout_session", (q) => q.eq("checkoutSessionId", args.checkoutSessionId))
      .first()
    const existing = existingEvent ?? existingSession
    if (existing) return { applied: false, userId: existing.userId }

    const user = await ctx.db.get("users", args.userId)
    if (!user) throw new Error("Stripe customer is not connected to a user")
    if (!Number.isSafeInteger(args.tokens) || args.tokens <= 0) throw new Error("Invalid token credit")

    await ctx.db.insert("payments", {
      stripeEventId: args.stripeEventId,
      checkoutSessionId: args.checkoutSessionId,
      userId: user._id,
      amountTotal: args.amountTotal,
      currency: args.currency,
      tokens: args.tokens,
      createdAt: Date.now(),
    })
    await ctx.db.patch("users", user._id, { tokens: (user.tokens ?? 0) + args.tokens })
    return { applied: true, userId: user._id }
  }
})
