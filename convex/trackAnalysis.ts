import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { trackAnalysisResultValidator } from "./trackAnalysisValidators";
import { getAnalysisRetryPolicy, sanitizeAnalysisError } from "../lib/analysisQueuePolicy";

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
    return {
      ...doc.result,
      segments: doc.result.segments?.map((segment) => {
        const { mood: _mood, ...clean } = segment as typeof segment & { mood?: unknown };
        return clean;
      }),
    };
  },
});

export const enqueue = internalMutation({
  args: {
    trackIds: v.array(v.string()),
    analysisVersion: v.string(),
    priority: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let enqueued = 0;
    let cached = 0;
    let existing = 0;

    for (const sourceTrackId of [...new Set(args.trackIds)].slice(0, 20)) {
      if (!/^\d+$/.test(sourceTrackId)) continue;
      const cacheKey = `soundcloud:${sourceTrackId}:${args.analysisVersion}`;
      const analysis = await ctx.db
        .query("trackAnalyses")
        .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
        .unique();
      if (analysis) {
        cached += 1;
        continue;
      }

      const job = await ctx.db
        .query("trackAnalysisJobs")
        .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
        .unique();
      if (job) {
        if (job.status === "dead") {
          await ctx.db.patch(job._id, {
            status: "queued",
            priority: Math.max(job.priority, args.priority),
            attempts: 0,
            nextAttemptAt: now,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            lastError: undefined,
            updatedAt: now,
          });
          enqueued += 1;
          continue;
        }
        existing += 1;
        if (args.priority > job.priority) {
          await ctx.db.patch(job._id, { priority: args.priority, updatedAt: now });
        }
        continue;
      }

      await ctx.db.insert("trackAnalysisJobs", {
        cacheKey,
        source: "soundcloud",
        sourceTrackId,
        analysisVersion: args.analysisVersion,
        status: "queued",
        priority: args.priority,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
      enqueued += 1;
    }

    return { enqueued, cached, existing };
  },
});

export const claim = internalMutation({
  args: {
    leaseToken: v.string(),
    leaseDurationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
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
      }
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

    return {
      cacheKey: job.cacheKey,
      sourceTrackId: job.sourceTrackId,
      analysisVersion: job.analysisVersion,
      attempt: job.attempts + 1,
      leaseToken: args.leaseToken,
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
    await ctx.db.delete(job._id);
    return { stored: !existing };
  },
});

export const fail = internalMutation({
  args: {
    cacheKey: v.string(),
    leaseToken: v.string(),
    error: v.string(),
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
    await ctx.db.patch(job._id, {
      status: retry.dead ? "dead" : "failed",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: retry.nextAttemptAt,
      lastError: sanitizeAnalysisError(args.error),
      updatedAt: now,
    });
    return { dead: retry.dead, attempts: job.attempts };
  },
});
