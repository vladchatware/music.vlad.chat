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
    .index("by_source_track_version", [
      "result.source",
      "result.sourceTrackId",
      "result.analysisVersion",
    ]),
});
