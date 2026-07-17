import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server";
import { trackAnalysisResultValidator } from "./trackAnalysisValidators";

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    stripeId: v.optional(v.string()),
    trialMessages: v.optional((v.number())),
    trialTokens: v.optional(v.number()),
    tokens: v.optional(v.number()),
    soundcloudAccessToken: v.optional(v.string()),
    soundcloudRefreshToken: v.optional(v.string())
  })
    .index("email", ["email"])
    .index('stripeId', ['stripeId']),
  usage: defineTable({
    userId: v.string(),
    model: v.string(),
    provider: v.string(),
    usage: v.object({
      totalTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      cachedInputTokens: v.optional(v.number()),
    })
  }),
  payments: defineTable({
    stripeEventId: v.string(),
    checkoutSessionId: v.string(),
    userId: v.id("users"),
    amountTotal: v.optional(v.number()),
    currency: v.optional(v.string()),
    tokens: v.number(),
    createdAt: v.number(),
  })
    .index("by_stripe_event", ["stripeEventId"])
    .index("by_checkout_session", ["checkoutSessionId"]),
  trackAnalysisJobs: defineTable({
    cacheKey: v.string(),
    source: v.literal("soundcloud"),
    sourceTrackId: v.string(),
    analysisVersion: v.string(),
    requestedBy: v.optional(v.id("users")),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("failed"),
      v.literal("dead"),
    ),
    priority: v.number(),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    sentryTrace: v.optional(v.string()),
    sentryBaggage: v.optional(v.string()),
    messageId: v.optional(v.string()),
    messageBodySize: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_cacheKey", ["cacheKey"])
    .index("by_status_priority_createdAt", ["status", "priority", "createdAt"]),
  trackAnalyses: defineTable({
    cacheKey: v.string(),
    result: trackAnalysisResultValidator,
    createdAt: v.number(),
  })
    .index("by_cacheKey", ["cacheKey"])
    .index("by_analysis_version_createdAt", ["result.analysisVersion", "createdAt"])
    .index("by_source_track_version", [
      "result.source",
      "result.sourceTrackId",
      "result.analysisVersion",
    ]),
});
