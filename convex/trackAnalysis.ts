import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { trackAnalysisResultValidator } from "./trackAnalysisValidators";
import { getAnalysisRetryPolicy, sanitizeAnalysisError } from "../lib/analysisQueuePolicy";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

function cleanResult<T extends { segments?: Array<Record<string, unknown>> }>(result: T) {
  return {
    ...result,
    segments: result.segments?.map((segment) => {
      const { mood: _mood, ...clean } = segment;
      return clean;
    }),
  };
}

export const getBySoundCloudId = query({
  args: {
    trackId: v.string(),
    analysisVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("trackAnalyses")
      .withIndex("by_source_track_version", (q) =>
        q
          .eq("result.source", "soundcloud")
          .eq("result.sourceTrackId", args.trackId)
          .eq("result.analysisVersion", args.analysisVersion),
      )
      .unique();
    if (!doc) return null;
    return cleanResult(doc.result);
  },
});

export const listCandidates = query({
  args: {
    excludeTrackId: v.string(),
    analysisVersion: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(30, Math.floor(args.limit ?? 20)));
    const docs = await ctx.db
      .query("trackAnalyses")
      .withIndex("by_analysis_version_createdAt", (q) =>
        q.eq("result.analysisVersion", args.analysisVersion),
      )
      .order("desc")
      .take(limit + 1);
    return docs
      .filter((doc) => doc.result.sourceTrackId !== args.excludeTrackId)
      .slice(0, limit)
      .map((doc) => cleanResult(doc.result));
  },
});

const enqueueArgs = {
  trackIds: v.array(v.string()),
  analysisVersion: v.string(),
  priority: v.number(),
  force: v.optional(v.boolean()),
  traceContexts: v.optional(v.array(v.object({
    trackId: v.string(),
    sentryTrace: v.optional(v.string()),
    sentryBaggage: v.optional(v.string()),
    messageId: v.string(),
    messageBodySize: v.number(),
    sentAt: v.number(),
  }))),
};

type EnqueueArgs = {
  trackIds: string[];
  analysisVersion: string;
  priority: number;
  force?: boolean;
  traceContexts?: Array<{
    trackId: string;
    sentryTrace?: string;
    sentryBaggage?: string;
    messageId: string;
    messageBodySize: number;
    sentAt: number;
  }>;
};

async function enqueueJobs(
  ctx: MutationCtx,
  args: EnqueueArgs,
  requestedBy?: Id<"users">,
) {
    const now = Date.now();
    let enqueued = 0;
    let cached = 0;
    let existing = 0;

    for (const sourceTrackId of [...new Set(args.trackIds)].slice(0, 20)) {
      if (!/^\d+$/.test(sourceTrackId)) continue;
      const cacheKey = `soundcloud:${sourceTrackId}:${args.analysisVersion}`;
      const incomingTrace = args.traceContexts?.find((trace) => trace.trackId === sourceTrackId);
      const messageBodySize = incomingTrace && Number.isFinite(incomingTrace.messageBodySize)
        ? Math.max(0, Math.min(1_000_000, incomingTrace.messageBodySize))
        : 0;
      const sentAt = incomingTrace && Number.isFinite(incomingTrace.sentAt)
        ? Math.max(0, Math.min(now, incomingTrace.sentAt))
        : now;
      const queueMetadata = {
        ...(incomingTrace?.sentryTrace
          ? { sentryTrace: incomingTrace.sentryTrace.slice(0, 512) }
          : {}),
        ...(incomingTrace?.sentryBaggage
          ? { sentryBaggage: incomingTrace.sentryBaggage.slice(0, 8_192) }
          : {}),
        messageId: cacheKey,
        messageBodySize,
        sentAt,
      };
      const analysis = await ctx.db
        .query("trackAnalyses")
        .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
        .unique();
      if (analysis) {
        if (args.force) {
          await ctx.db.delete(analysis._id);
        } else {
          cached += 1;
          continue;
        }
      }

      const job = await ctx.db
        .query("trackAnalysisJobs")
        .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
        .unique();
      if (job) {
        if (job.status === "dead") {
          if (job.lastError?.includes("[NON_STREAMABLE]")) {
            existing += 1;
            continue;
          }
          await ctx.db.patch(job._id, {
            status: "queued",
            priority: Math.max(job.priority, args.priority),
            attempts: 0,
            nextAttemptAt: now,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            lastError: undefined,
            ...queueMetadata,
            ...(requestedBy ? { requestedBy } : {}),
            createdAt: now,
            updatedAt: now,
          });
          enqueued += 1;
          continue;
        }
        existing += 1;
        if (args.priority > job.priority) {
          await ctx.db.patch(job._id, {
            priority: args.priority,
            ...(requestedBy ? { requestedBy } : {}),
            updatedAt: now,
          });
        } else if (requestedBy && job.requestedBy !== requestedBy) {
          await ctx.db.patch(job._id, { requestedBy, updatedAt: now });
        }
        continue;
      }

      await ctx.db.insert("trackAnalysisJobs", {
        cacheKey,
        source: "soundcloud",
        sourceTrackId,
        analysisVersion: args.analysisVersion,
        ...(requestedBy ? { requestedBy } : {}),
        status: "queued",
        priority: args.priority,
        attempts: 0,
        nextAttemptAt: now,
        ...queueMetadata,
        createdAt: now,
        updatedAt: now,
      });
      enqueued += 1;
    }

    await ctx.scheduler.runAfter(0, internal.telemetry.recordAnalysisEvent, {
      event: "enqueue",
      source: requestedBy ? "user" : "service",
      ...(requestedBy ? { userId: String(requestedBy) } : {}),
      enqueued,
      cached,
      existing,
    });
    return { enqueued, cached, existing };
}

export const enqueue = internalMutation({
  args: {
    ...enqueueArgs,
    soundcloudUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { soundcloudUserId, ...rest } = args;
    let requestedBy: Id<"users"> | undefined;
    if (soundcloudUserId) {
      const account = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "soundcloud").eq("providerAccountId", soundcloudUserId),
        )
        .unique();
      if (account) {
        requestedBy = account.userId as Id<"users">;
      }
    }
    return enqueueJobs(ctx, rest, requestedBy);
  },
});

export const enqueueForViewer = mutation({
  args: enqueueArgs,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (!user || user.isAnonymous || !user.soundcloudAccessToken) {
      throw new Error("SoundCloud authentication required");
    }
    return enqueueJobs(ctx, args, userId);
  },
});

export const claim = internalMutation({
  args: {
    leaseToken: v.string(),
    leaseDurationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let expiredRetryable = 0;
    let expiredDead = 0;
    const expired = await ctx.db
      .query("trackAnalysisJobs")
      .withIndex("by_status_priority_createdAt", (q) => q.eq("status", "processing"))
      .take(50);
    for (const job of expired) {
      if ((job.leaseExpiresAt ?? Number.POSITIVE_INFINITY) <= now) {
        const retry = getAnalysisRetryPolicy(job.attempts, now);
        await ctx.db.patch(job._id, {
          status: retry.dead ? "dead" : "failed",
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          nextAttemptAt: retry.nextAttemptAt,
          lastError: "Worker lease expired",
          updatedAt: now,
        });
        if (retry.dead) expiredDead += 1;
        else expiredRetryable += 1;
      }
    }
    if (expiredRetryable > 0) {
      await ctx.scheduler.runAfter(0, internal.telemetry.recordAnalysisEvent, {
        event: "lease_expired",
        count: expiredRetryable,
        dead: false,
      });
    }
    if (expiredDead > 0) {
      await ctx.scheduler.runAfter(0, internal.telemetry.recordAnalysisEvent, {
        event: "lease_expired",
        count: expiredDead,
        dead: true,
      });
    }

    const findReady = async (status: "queued" | "failed") => {
      const candidates = await ctx.db
        .query("trackAnalysisJobs")
        .withIndex("by_status_priority_createdAt", (q) => q.eq("status", status))
        .order("desc")
        .take(50);
      return candidates.find((job) => job.nextAttemptAt <= now) ?? null;
    };

    const job = (await findReady("queued")) ?? (await findReady("failed"));
    if (!job) return null;

    await ctx.db.patch(job._id, {
      status: "processing",
      attempts: job.attempts + 1,
      leaseToken: args.leaseToken,
      leaseExpiresAt: now + Math.max(60_000, args.leaseDurationMs),
      updatedAt: now,
    });

    const user = job.requestedBy ? await ctx.db.get(job.requestedBy) : null;
    await ctx.scheduler.runAfter(0, internal.telemetry.recordAnalysisEvent, {
      event: "claimed",
      source: job.requestedBy ? "user" : "service",
      ...(job.requestedBy ? { userId: String(job.requestedBy) } : {}),
      trackId: job.sourceTrackId,
      attempt: job.attempts + 1,
      queueWaitMs: Math.max(0, now - job.createdAt),
    });
    return {
      cacheKey: job.cacheKey,
      sourceTrackId: job.sourceTrackId,
      analysisVersion: job.analysisVersion,
      attempt: job.attempts + 1,
      leaseToken: args.leaseToken,
      createdAt: job.createdAt,
      sentryTrace: job.sentryTrace,
      sentryBaggage: job.sentryBaggage,
      messageId: job.messageId ?? job.cacheKey,
      messageBodySize: job.messageBodySize,
      sentAt: job.sentAt ?? job.createdAt,
    };
  },
});

export const claimSpecific = internalMutation({
  args: {
    cacheKey: v.string(),
    leaseToken: v.string(),
    leaseDurationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db
      .query("trackAnalysisJobs")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();

    if (!job) return { status: "done" as const };
    if (job.status === "dead") return { status: "dead" as const };

    if (job.status === "processing" && (job.leaseExpiresAt ?? Number.POSITIVE_INFINITY) > now) {
      return {
        status: "waiting" as const,
        retryAt: job.leaseExpiresAt ?? now + 60_000,
      };
    }

    if (job.status === "processing") {
      const retry = getAnalysisRetryPolicy(job.attempts, now);
      await ctx.db.patch(job._id, {
        status: retry.dead ? "dead" : "failed",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        nextAttemptAt: retry.nextAttemptAt,
        lastError: "Worker lease expired",
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.telemetry.recordAnalysisEvent, {
        event: "lease_expired",
        count: 1,
        dead: retry.dead,
      });
      if (retry.dead) return { status: "dead" as const };
      return { status: "waiting" as const, retryAt: retry.nextAttemptAt };
    }

    if (job.nextAttemptAt > now) {
      return { status: "waiting" as const, retryAt: job.nextAttemptAt };
    }

    await ctx.db.patch(job._id, {
      status: "processing",
      attempts: job.attempts + 1,
      leaseToken: args.leaseToken,
      leaseExpiresAt: now + Math.max(60_000, args.leaseDurationMs),
      updatedAt: now,
    });

    const user = job.requestedBy ? await ctx.db.get(job.requestedBy) : null;
    await ctx.scheduler.runAfter(0, internal.telemetry.recordAnalysisEvent, {
      event: "claimed",
      source: job.requestedBy ? "user" : "service",
      ...(job.requestedBy ? { userId: String(job.requestedBy) } : {}),
      trackId: job.sourceTrackId,
      attempt: job.attempts + 1,
      queueWaitMs: Math.max(0, now - job.createdAt),
    });
    return {
      status: "claimed" as const,
      job: {
        cacheKey: job.cacheKey,
        sourceTrackId: job.sourceTrackId,
        analysisVersion: job.analysisVersion,
        attempt: job.attempts + 1,
        leaseToken: args.leaseToken,
          createdAt: job.createdAt,
        sentryTrace: job.sentryTrace,
        sentryBaggage: job.sentryBaggage,
        messageId: job.messageId ?? job.cacheKey,
        messageBodySize: job.messageBodySize,
        sentAt: job.sentAt ?? job.createdAt,
      },
    };
  },
});

export const complete = internalMutation({
  args: {
    cacheKey: v.string(),
    leaseToken: v.string(),
    result: trackAnalysisResultValidator,
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("trackAnalysisJobs")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();
    if (!job || job.status !== "processing" || job.leaseToken !== args.leaseToken) {
      throw new Error("Invalid or expired analysis lease");
    }
    if (
      args.result.sourceTrackId !== job.sourceTrackId ||
      args.result.analysisVersion !== job.analysisVersion
    ) {
      throw new Error("Analysis result does not match job");
    }
    if (
      args.result.source !== "soundcloud" ||
      `soundcloud:${args.result.sourceTrackId}:${args.result.analysisVersion}` !== args.cacheKey ||
      !Number.isFinite(args.result.durationSec) ||
      args.result.durationSec <= 0 ||
      args.result.durationSec > 601 ||
      args.result.tempo.bpm < 40 ||
      args.result.tempo.bpm > 250 ||
      args.result.tempo.beatsSec.length > 5_000 ||
      args.result.energy.samples.length > 2_000 ||
      !args.result.segments ||
      args.result.segments.length === 0 ||
      args.result.segments.length > 128 ||
      args.result.cuePoints.mixInSec < 0 ||
      args.result.cuePoints.mixOutSec < args.result.cuePoints.mixInSec ||
      args.result.cuePoints.mixOutSec > args.result.durationSec
    ) {
      throw new Error("Analysis result failed semantic validation");
    }

    const existing = await ctx.db
      .query("trackAnalyses")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();
    if (!existing) {
      await ctx.db.insert("trackAnalyses", {
        cacheKey: args.cacheKey,
        result: args.result,
        createdAt: Date.now(),
      });
    }
    const completedAt = Date.now();
    await ctx.db.delete(job._id);
    await ctx.scheduler.runAfter(0, internal.telemetry.recordAnalysisEvent, {
      event: "completed",
      source: job.requestedBy ? "user" : "service",
      ...(job.requestedBy ? { userId: String(job.requestedBy) } : {}),
      trackId: job.sourceTrackId,
      attempt: job.attempts,
      stored: !existing,
      processingTimeMs: args.result.processingTimeMs,
      totalTimeMs: Math.max(0, completedAt - job.createdAt),
      semanticStatus: args.result.semantic?.status ?? "unavailable",
    });
    return { stored: !existing };
  },
});

export const fail = internalMutation({
  args: {
    cacheKey: v.string(),
    leaseToken: v.string(),
    error: v.string(),
    noRetry: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("trackAnalysisJobs")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();
    if (!job || job.status !== "processing" || job.leaseToken !== args.leaseToken) {
      throw new Error("Invalid or expired analysis lease");
    }

    const now = Date.now();
    const retry = getAnalysisRetryPolicy(job.attempts, now);
    const dead = args.noRetry || retry.dead;
    await ctx.db.patch(job._id, {
      status: dead ? "dead" : "failed",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: dead ? Number.MAX_SAFE_INTEGER : retry.nextAttemptAt,
      lastError: sanitizeAnalysisError(args.error),
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.telemetry.recordAnalysisEvent, {
      event: "failed",
      source: job.requestedBy ? "user" : "service",
      ...(job.requestedBy ? { userId: String(job.requestedBy) } : {}),
      trackId: job.sourceTrackId,
      attempt: job.attempts,
      dead,
      totalTimeMs: Math.max(0, now - job.createdAt),
    });
    return {
      dead,
      attempts: job.attempts,
      nextAttemptAt: dead ? Number.MAX_SAFE_INTEGER : retry.nextAttemptAt,
    };
  },
});

export const defer = internalMutation({
  args: {
    cacheKey: v.string(),
    leaseToken: v.string(),
    retryMs: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("trackAnalysisJobs")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();
    if (!job || job.status !== "processing" || job.leaseToken !== args.leaseToken) {
      throw new Error("Invalid or expired analysis lease");
    }
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "queued",
      attempts: Math.max(0, job.attempts - 1),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: now + Math.min(30 * 60_000, Math.max(1_000, args.retryMs)),
      lastError: sanitizeAnalysisError(args.reason),
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.telemetry.recordAnalysisEvent, {
      event: "deferred",
      source: job.requestedBy ? "user" : "service",
      ...(job.requestedBy ? { userId: String(job.requestedBy) } : {}),
      trackId: job.sourceTrackId,
      attempt: Math.max(0, job.attempts - 1),
    });
  },
});
