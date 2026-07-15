import { TRACK_ANALYSIS_VERSION } from "../trackAnalysis";

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
): Promise<boolean> {
  const result = await enqueueTrackAnalyses([trackId], priority);
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
): Promise<AnalysisEnqueueResult | null> {
  if (process.env.DJ_ANALYSIS_QUEUE_ENABLED !== "true") return null;
  const siteUrl = getConvexSiteUrl();
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  const normalized = [...new Set(trackIds.map(String).filter((id) => /^\d+$/.test(id)))].slice(0, 20);
  if (!siteUrl || !secret || normalized.length === 0) return null;

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
    }),
  });
  if (!response.ok) {
    throw new Error(`Analysis enqueue failed with status ${response.status}`);
  }
  return await response.json() as AnalysisEnqueueResult;
}
