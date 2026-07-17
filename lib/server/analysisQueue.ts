import { TRACK_ANALYSIS_VERSION } from "../trackAnalysis";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import * as Sentry from "@sentry/nextjs";

const ANALYSIS_QUEUE_NAME = "track-analysis";

type AnalysisTraceContext = {
  trackId: string;
  sentryTrace?: string;
  sentryBaggage?: string;
  messageId: string;
  messageBodySize: number;
  sentAt: number;
};

function getConvexSiteUrl(): string | null {
  if (process.env.CONVEX_SITE_URL) {
    return process.env.CONVEX_SITE_URL.replace(/\/+$/, "").replace(/\/api$/, "");
  }
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (cloud?.includes(".convex.cloud")) {
    return cloud.replace(".convex.cloud", ".convex.site").replace(/\/$/, "");
  }
  return null;
}

export async function enqueueTrackAnalysis(
  trackId: string | number,
  priority = 0,
  convexToken?: string,
): Promise<boolean> {
  const result = await enqueueTrackAnalyses([trackId], priority, convexToken);
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
): Promise<AnalysisEnqueueResult | null> {
  if (process.env.DJ_ANALYSIS_QUEUE_ENABLED !== "true") return null;
  const normalized = [...new Set(trackIds.map(String).filter((id) => /^\d+$/.test(id)))].slice(0, 20);
  if (normalized.length === 0) return null;
  const siteUrl = convexToken ? null : getConvexSiteUrl();
  const secret = convexToken ? null : process.env.ANALYSIS_SERVICE_SECRET;
  if (!convexToken && (!siteUrl || !secret)) return null;

  return await Sentry.startSpan({ name: "track-analysis enqueue" }, async (parentSpan) => {
    const sentAt = Date.now();
    const publications = normalized.map((trackId) => {
      const messageId = `soundcloud:${trackId}:${TRACK_ANALYSIS_VERSION}`;
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
      let result: AnalysisEnqueueResult;
      if (convexToken) {
        result = await fetchMutation(api.trackAnalysis.enqueueForViewer, {
          trackIds: normalized,
          priority,
          analysisVersion: TRACK_ANALYSIS_VERSION,
          traceContexts,
        }, { token: convexToken });
      } else {
        const response = await fetch(`${siteUrl}/analysis/enqueue`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            trackIds: normalized,
            priority,
            analysisVersion: TRACK_ANALYSIS_VERSION,
            traceContexts,
          }),
        });
        if (!response.ok) {
          throw new Error(`Analysis enqueue failed with status ${response.status}`);
        }
        result = await response.json() as AnalysisEnqueueResult;
      }
      for (const { span } of publications) span.setStatus({ code: 1, message: "ok" });
      parentSpan.setStatus({ code: 1, message: "ok" });
      return result;
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
