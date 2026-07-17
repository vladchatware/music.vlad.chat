import * as Sentry from "@sentry/node";
import type { AnalysisJob } from "./api";

const ANALYSIS_QUEUE_NAME = "track-analysis";

export async function processWithQueueTrace<T>(
  job: AnalysisJob,
  processor: () => T | Promise<T>,
  now = Date.now(),
): Promise<T> {
  const sentAt = job.sentAt ?? job.createdAt ?? now;
  return Sentry.continueTrace({
    sentryTrace: job.sentryTrace,
    baggage: job.sentryBaggage,
  }, () => Sentry.startSpan({ name: "track-analysis consumer" }, async (parentSpan) => {
    try {
      const result = await Sentry.startSpan({
        name: "track-analysis process",
        op: "queue.process",
        attributes: {
          "messaging.destination.name": ANALYSIS_QUEUE_NAME,
          "messaging.message.id": job.messageId ?? job.cacheKey,
          "messaging.message.body.size": job.messageBodySize ?? 0,
          "messaging.message.retry.count": Math.max(0, job.attempt - 1),
          "messaging.message.receive.latency": Math.max(0, now - sentAt),
        },
      }, async (span) => {
        try {
          const processed = await processor();
          span.setStatus({ code: 1, message: "ok" });
          return processed;
        } catch (error) {
          span.setStatus({ code: 2, message: "internal_error" });
          throw error;
        }
      });
      parentSpan.setStatus({ code: 1, message: "ok" });
      return result;
    } catch (error) {
      parentSpan.setStatus({ code: 2, message: "internal_error" });
      throw error;
    }
  }));
}
