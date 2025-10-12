import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId !== null ? ctx.db.get(userId) : null;
  },
});

export const connect = mutation({
  args: { stripeId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    return ctx.db.patch(userId, { stripeId: args.stripeId })
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

export const topup = internalMutation({
  args: { tokens: v.number(), stripeId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query('users').withIndex('stripeId', q => q.eq('stripeId', args.stripeId)).first()
    return ctx.db.patch(user._id, { tokens: user.tokens + args.tokens })
  }
})
