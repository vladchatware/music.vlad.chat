"use node";

import * as Sentry from "@sentry/node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.CONVEX_DEPLOYMENT ?? "convex",
  enableLogs: true,
  enableMetrics: true,
  tracesSampleRate: 0,
});

export const recordBusinessEvent = internalAction({
  args: {
    event: v.union(v.literal("auth.user_created"), v.literal("commerce.payment.completed")),
    userId: v.string(),
    provider: v.optional(v.string()),
    authType: v.optional(v.string()),
    amountTotal: v.optional(v.number()),
    currency: v.optional(v.string()),
    tokens: v.optional(v.number()),
  },
  returns: v.object({ sent: v.boolean() }),
  handler: async (_ctx, args) => {
    if (!process.env.SENTRY_DSN) return { sent: false };

    Sentry.withScope((scope) => {
      scope.setUser({ id: args.userId });
      if (args.event === "auth.user_created") {
        const attributes = {
          provider: args.provider ?? "unknown",
          auth_type: args.authType ?? "unknown",
        };
        Sentry.logger.info("User created", attributes);
        Sentry.metrics.count("auth.signup", 1, { attributes });
      } else {
        const attributes = { currency: args.currency ?? "unknown" };
        Sentry.logger.info("Payment completed", {
          ...attributes,
          amount_total: args.amountTotal,
          tokens: args.tokens,
        });
        Sentry.metrics.count("commerce.payment.completed", 1, { attributes });
        if (args.amountTotal !== undefined) {
          Sentry.metrics.distribution("commerce.payment.amount_minor_units", args.amountTotal, {
            attributes,
          });
        }
        if (args.tokens !== undefined) {
          Sentry.metrics.distribution("commerce.payment.tokens", args.tokens, { attributes });
        }
      }
    });
    await Sentry.flush(2_000);
    return { sent: true };
  },
});

export const recordAnalysisEvent = internalAction({
  args: {
    event: v.union(
      v.literal("enqueue"),
      v.literal("claimed"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("deferred"),
      v.literal("lease_expired"),
    ),
    source: v.optional(v.union(v.literal("user"), v.literal("service"))),
    userId: v.optional(v.string()),
    trackId: v.optional(v.string()),
    enqueued: v.optional(v.number()),
    cached: v.optional(v.number()),
    existing: v.optional(v.number()),
    count: v.optional(v.number()),
    attempt: v.optional(v.number()),
    dead: v.optional(v.boolean()),
    stored: v.optional(v.boolean()),
    queueWaitMs: v.optional(v.number()),
    processingTimeMs: v.optional(v.number()),
    totalTimeMs: v.optional(v.number()),
    semanticStatus: v.optional(v.string()),
  },
  returns: v.object({ sent: v.boolean() }),
  handler: async (_ctx, args) => {
    if (!process.env.SENTRY_DSN) return { sent: false };

    Sentry.withScope((scope) => {
      if (args.userId) scope.setUser({ id: args.userId });
      const logAttributes = {
        event: args.event,
        track_id: args.trackId,
        source: args.source,
        attempt: args.attempt,
        dead: args.dead,
      };
      if (args.event === "enqueue") {
        const source = args.source ?? "service";
        Sentry.logger.info("Track analysis enqueue resolved", {
          ...logAttributes,
          enqueued: args.enqueued,
          cached: args.cached,
          existing: args.existing,
        });
        for (const [outcome, value] of [
          ["queued", args.enqueued],
          ["cached", args.cached],
          ["existing", args.existing],
        ] as const) {
          if (value) {
            Sentry.metrics.count("analysis.track.enqueue", value, {
              attributes: { source, outcome },
            });
          }
        }
      } else if (args.event === "claimed") {
        Sentry.logger.info("Track analysis claimed", logAttributes);
        Sentry.metrics.count("analysis.track.claimed", 1, {
          attributes: { source: args.source ?? "service" },
        });
        if (args.queueWaitMs !== undefined) {
          Sentry.metrics.distribution("analysis.track.queue_wait", args.queueWaitMs, {
            unit: "millisecond",
          });
        }
        if (args.attempt !== undefined) {
          Sentry.metrics.distribution("analysis.track.attempt", args.attempt);
        }
      } else if (args.event === "completed") {
        Sentry.logger.info("Track analysis completed", {
          ...logAttributes,
          stored: args.stored,
          semantic_status: args.semanticStatus,
        });
        Sentry.metrics.count("analysis.track.processed", 1, {
          attributes: {
            stored: args.stored ?? false,
            semantic_status: args.semanticStatus ?? "unknown",
          },
        });
        if (args.processingTimeMs !== undefined) {
          Sentry.metrics.distribution("analysis.track.processing_time", args.processingTimeMs, {
            unit: "millisecond",
          });
        }
        if (args.totalTimeMs !== undefined) {
          Sentry.metrics.distribution("analysis.track.total_time", args.totalTimeMs, {
            unit: "millisecond",
          });
        }
      } else if (args.event === "failed" || args.event === "lease_expired") {
        const failureType = args.event === "lease_expired" ? "lease_expired" : "processing";
        Sentry.logger.error("Track analysis failed", {
          ...logAttributes,
          failure_type: failureType,
          count: args.count,
        });
        Sentry.metrics.count("analysis.track.failed", args.count ?? 1, {
          attributes: { failure_type: failureType, terminal: args.dead ?? false },
        });
      } else {
        Sentry.logger.warn("Track analysis deferred", logAttributes);
        Sentry.metrics.count("analysis.track.deferred", 1, {
          attributes: { reason: "soundcloud_auth" },
        });
      }
    });
    await Sentry.flush(2_000);
    return { sent: true };
  },
});
