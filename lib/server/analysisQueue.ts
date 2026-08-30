import { TRACK_ANALYSIS_VERSION } from "../trackAnalysis";
import {
  ANALYSIS_QUEUE_RETENTION_SECONDS,
  trackAnalysisCacheKey,
  type AnalysisTraceContext,
  type TrackAnalysisQueueMessage,
} from "../analysisQueueMessage";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import * as Sentry from "@sentry/nextjs";
import { QueueClient } from "@vercel/queue";
import { VercelQueueTokenProvider } from "./vercelQueueAuth";

const ANALYSIS_QUEUE_NAME = "track-analysis";

type AnalysisEnqueueBody = {
  trackIds: string[];
  analysisVersion: string;
  priority: number;
  force?: boolean;
  soundcloudUserId?: string;
  requestedBy?: string;
  traceContexts?: AnalysisTraceContext[];
};

let queueClient: QueueClient | undefined;
const tokenProvider = new VercelQueueTokenProvider();

function queueTopic(): string {
  return process.env.VERCEL_QUEUE_TOPIC || ANALYSIS_QUEUE_NAME;
}

function queueRegion(): string {
  return process.env.VERCEL_QUEUE_REGION || "iad1";
}

async function getQueueClient(): Promise<QueueClient> {
  // Queue visibility is partitioned by the token's environment claim, and the
  // worker only holds development-scoped tokens — so the publisher must mint
  // tokens the same way instead of relying on its production OIDC context.
  const staticToken = process.env.VERCEL_QUEUE_TOKEN;
  if (staticToken) {
    queueClient ??= new QueueClient({ region: queueRegion(), deploymentId: null, token: staticToken });
    return queueClient;
  }
  if (process.env.VERCEL_API_TOKEN) {
    return new QueueClient({
      region: queueRegion(),
      // Messages must not be pinned to a single deployment: the consumer is
      // an external worker polling in deploymentless mode.
      deploymentId: null,
      token: await tokenProvider.getToken(),
    });
  }
  queueClient ??= new QueueClient({ region: queueRegion(), deploymentId: null });
  return queueClient;
}

function convexSiteUrl(): string {
  const configured = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "").replace(/\/api$/, "");
  const cloudUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (cloudUrl?.includes(".convex.cloud")) {
    return cloudUrl.replace(".convex.cloud", ".convex.site").replace(/\/+$/, "");
  }
  throw new Error("Convex site URL required");
}

export async function enqueueTrackAnalysis(
  trackId: string | number,
  priority = 0,
  convexToken?: string,
  force?: boolean,
): Promise<boolean> {
  const result = await enqueueTrackAnalyses([trackId], priority, convexToken, force);
  return result !== null;
}

export type AnalysisEnqueueResult = {
  enqueued: number;
  cached: number;
  existing: number;
};

export async function enqueueTrackAnalyses(
  trackIds: Array<string | number>,
  priority = 0,
  convexToken?: string,
  force?: boolean,
  soundcloudUserId?: string,
): Promise<AnalysisEnqueueResult | null> {
  if (process.env.DJ_ANALYSIS_QUEUE_ENABLED !== "true") return null;
  const normalized = [...new Set(trackIds.map(String).filter((id) => /^\d+$/.test(id)))].slice(0, 20);
  if (normalized.length === 0) return null;
  if (!process.env.ANALYSIS_SERVICE_SECRET) return null;

  return await Sentry.startSpan({ name: "track-analysis enqueue" }, async (parentSpan) => {
    const sentAt = Date.now();
    const publications = normalized.map((trackId) => {
      const messageId = trackAnalysisCacheKey(trackId, TRACK_ANALYSIS_VERSION);
      const messageBodySize = new TextEncoder().encode(JSON.stringify({
        source: "soundcloud",
        sourceTrackId: trackId,
        analysisVersion: TRACK_ANALYSIS_VERSION,
      })).byteLength;
      const span = Sentry.startInactiveSpan({
        name: "track-analysis publish",
        op: "queue.publish",
        attributes: {
          "messaging.destination.name": ANALYSIS_QUEUE_NAME,
          "messaging.message.id": messageId,
          "messaging.message.body.size": messageBodySize,
        },
      });
      const traceData = Sentry.getTraceData({ span });
      const traceContext: AnalysisTraceContext = {
        trackId,
        ...(traceData["sentry-trace"] ? { sentryTrace: traceData["sentry-trace"] } : {}),
        ...(traceData.baggage ? { sentryBaggage: traceData.baggage } : {}),
        messageId,
        messageBodySize,
        sentAt,
      };
      return { span, traceContext };
    });
    const traceContexts = publications.map(({ traceContext }) => traceContext);

    try {
      const requestedBy = convexToken
        ? await fetchMutation(api.trackAnalysis.prepareForViewer, {}, { token: convexToken })
        : undefined;
      const counts = await enqueueJobsInConvex({
        trackIds: normalized,
        analysisVersion: TRACK_ANALYSIS_VERSION,
        priority,
        ...(force ? { force: true } : {}),
        ...(soundcloudUserId ? { soundcloudUserId } : {}),
        ...(requestedBy ? { requestedBy } : {}),
        traceContexts,
      });
      await publishMessages(normalized.map((trackId, index) => ({
        trackId,
        analysisVersion: TRACK_ANALYSIS_VERSION,
        priority,
        ...(force ? { force: true } : {}),
        ...(soundcloudUserId ? { soundcloudUserId } : {}),
        ...(requestedBy ? { requestedBy } : {}),
        traceContext: traceContexts[index],
      })));
      for (const { span } of publications) span.setStatus({ code: 1, message: "ok" });
      parentSpan.setStatus({ code: 1, message: "ok" });
      return counts;
    } catch (error) {
      for (const { span } of publications) {
        span.setStatus({ code: 2, message: "internal_error" });
      }
      parentSpan.setStatus({ code: 2, message: "internal_error" });
      throw error;
    } finally {
      for (const { span } of publications) span.end();
    }
  });
}

async function enqueueJobsInConvex(body: AnalysisEnqueueBody): Promise<AnalysisEnqueueResult> {
  const response = await fetch(`${convexSiteUrl()}/analysis/enqueue`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.ANALYSIS_SERVICE_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Analysis enqueue failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  return await response.json() as AnalysisEnqueueResult;
}

async function publishMessages(payloads: TrackAnalysisQueueMessage[]): Promise<void> {
  const client = await getQueueClient();
  await Promise.all(payloads.map((payload) => client.send(queueTopic(), payload, {
    idempotencyKey: trackAnalysisCacheKey(payload.trackId, payload.analysisVersion),
    retentionSeconds: ANALYSIS_QUEUE_RETENTION_SECONDS,
  })));
}
