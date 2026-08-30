import { PollingQueueClient, type MessageMetadata } from "@vercel/queue";
import {
  parseTrackAnalysisQueueMessage,
  trackAnalysisCacheKey,
} from "../../lib/analysisQueueMessage";
import type { AnalysisQueueClient } from "./api";
import { captureWorkerException, type JobProcessor } from "./jobProcessor";
import * as Sentry from "@sentry/node";

const workerMetricAttributes = { component: "track-analysis-worker" };

export const MAX_QUEUE_DELIVERY_COUNT = 50;

export class QueueRetrySignal extends Error {
  constructor(
    readonly afterSeconds: number,
    message: string,
  ) {
    super(message);
    this.name = "QueueRetrySignal";
  }
}

export function retrySeconds(msUntil: number): number {
  if (!Number.isFinite(msUntil) || msUntil <= 0) return 1;
  return Math.max(1, Math.min(3_600, Math.ceil(msUntil / 1_000)));
}

export function deliveryBackoffSeconds(deliveryCount: number): number {
  return Math.min(300, 30 * 2 ** Math.max(0, deliveryCount - 1));
}

export type QueueMessageHandler = (
  message: unknown,
  metadata: MessageMetadata,
) => Promise<void>;

export type QueueMessageHandlerDeps = {
  convexQueue: Pick<AnalysisQueueClient, "claimSpecific">;
  processJob: JobProcessor;
  now?: () => number;
  maxDeliveryCount?: number;
};

export function createQueueMessageHandler(deps: QueueMessageHandlerDeps): QueueMessageHandler {
  const now = deps.now ?? Date.now;
  const maxDeliveryCount = deps.maxDeliveryCount ?? MAX_QUEUE_DELIVERY_COUNT;

  return async function handleQueueMessage(message, metadata): Promise<void> {
    const payload = parseTrackAnalysisQueueMessage(message);
    if (!payload) {
      console.error("analysis.queue.invalid_message", {
        messageId: metadata.messageId,
        deliveryCount: metadata.deliveryCount,
      });
      Sentry.metrics.count("analysis.worker.queue_invalid_message", 1, {
        attributes: workerMetricAttributes,
      });
      // Acknowledge: a malformed payload can never succeed.
      return;
    }
    if (metadata.deliveryCount > maxDeliveryCount) {
      console.error("analysis.queue.delivery_limit_exceeded", {
        messageId: metadata.messageId,
        deliveryCount: metadata.deliveryCount,
        trackId: payload.trackId,
      });
      captureWorkerException(
        "queue_delivery_limit",
        new Error(`Queue delivery limit exceeded (${metadata.deliveryCount})`),
        { trackId: payload.trackId, deliveryCount: metadata.deliveryCount },
      );
      // Acknowledge to stop burning queue operations; the Convex job is
      // revived whenever the track is enqueued again.
      return;
    }

    const cacheKey = trackAnalysisCacheKey(payload.trackId, payload.analysisVersion);
    let claim: Awaited<ReturnType<AnalysisQueueClient["claimSpecific"]>>;
    try {
      claim = await deps.convexQueue.claimSpecific(cacheKey);
    } catch (error) {
      captureWorkerException("queue_claim", error, {
        cacheKey,
        deliveryCount: metadata.deliveryCount,
      });
      Sentry.metrics.count("analysis.worker.queue_claim_error", 1, {
        attributes: workerMetricAttributes,
      });
      throw new QueueRetrySignal(
        deliveryBackoffSeconds(metadata.deliveryCount),
        `Analysis claim failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    switch (claim.status) {
      case "done":
      case "dead":
        return;
      case "waiting":
        throw new QueueRetrySignal(
          retrySeconds(claim.retryAt - now()),
          `Analysis job waiting until ${new Date(claim.retryAt).toISOString()}`,
        );
      case "claimed": {
        const outcome = await deps.processJob(claim.job);
        if (outcome.status === "waiting") {
          throw new QueueRetrySignal(
            retrySeconds(outcome.retryAfterMs),
            "Analysis job deferred for retry",
          );
        }
        return;
      }
    }
  };
}

export function createQueueRetryPolicy(maxDeliveryCount: number = MAX_QUEUE_DELIVERY_COUNT) {
  return (error: unknown, metadata: MessageMetadata) => {
    if (error instanceof QueueRetrySignal) return { afterSeconds: error.afterSeconds };
    if (metadata.deliveryCount >= maxDeliveryCount) return { acknowledge: true } as const;
    return { afterSeconds: deliveryBackoffSeconds(metadata.deliveryCount) } as const;
  };
}

export type QueueSlotOptions = {
  tokenProvider: { getToken: () => Promise<string> };
  region: string;
  topic: string;
  consumerGroup: string;
  visibilityTimeoutSeconds: number;
  pollIntervalMs: number;
  slotWaitMs: number;
  handleMessage: QueueMessageHandler;
  acquireSlot: () => boolean;
  releaseSlot: () => void;
  isStopping: () => boolean;
  maxDeliveryCount?: number;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runQueueSlot(options: QueueSlotOptions): Promise<void> {
  const retry = createQueueRetryPolicy(options.maxDeliveryCount);
  while (!options.isStopping()) {
    if (!options.acquireSlot()) {
      await wait(options.slotWaitMs);
      continue;
    }
    let idle = false;
    try {
      const token = await options.tokenProvider.getToken();
      const client = new PollingQueueClient({
        region: options.region,
        token,
        // Consume across all publisher deployments; versioning is handled by
        // the analysisVersion inside the message and Convex job state.
        deploymentId: null,
      });
      const result = await client.receive(
        options.topic,
        options.consumerGroup,
        options.handleMessage,
        { visibilityTimeoutSeconds: options.visibilityTimeoutSeconds, retry },
      );
      // strict:false disables literal-discriminant narrowing for this union.
      const { ok, reason } = result as { ok: boolean; reason?: string };
      if (ok) {
        Sentry.metrics.count("analysis.worker.queue_processed", 1, {
          attributes: workerMetricAttributes,
        });
      } else {
        idle = reason === "empty";
      }
    } catch (error) {
      console.error("analysis.queue.receive_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      captureWorkerException("queue_receive", error, { topic: options.topic });
      Sentry.metrics.count("analysis.worker.queue_receive_error", 1, {
        attributes: workerMetricAttributes,
      });
      idle = true;
    } finally {
      options.releaseSlot();
    }
    if (idle) await wait(options.pollIntervalMs);
  }
}
