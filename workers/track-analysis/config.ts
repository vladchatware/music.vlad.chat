export const ANALYSIS_SAMPLE_RATE = 22_050;
export { MAX_BODY_TRACK_DURATION_SEC as MAX_TRACK_DURATION_SEC } from "../../lib/dj/lastingSet";
export const ENERGY_SAMPLE_RATE = 2;
export const DEFAULT_LEASE_DURATION_MS = 15 * 60_000;

export const QUEUE_VISIBILITY_TIMEOUT_SECONDS = 900;
export const QUEUE_SLOT_WAIT_MS = 250;

export function getQueueRegion(): string {
  return process.env.VERCEL_QUEUE_REGION || "iad1";
}

export function getQueueTopic(): string {
  return process.env.VERCEL_QUEUE_TOPIC || "track-analysis";
}

export function getQueueConsumerGroup(): string {
  return process.env.VERCEL_QUEUE_CONSUMER_GROUP || "track-analysis-worker";
}

export function getQueuePollIntervalMs(): number {
  const parsed = Number.parseInt(process.env.VERCEL_QUEUE_POLL_INTERVAL_MS || "2000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
}

export function isQueueAuthConfigured(): boolean {
  return Boolean(process.env.VERCEL_QUEUE_TOKEN || process.env.VERCEL_API_TOKEN);
}

export function getConvexSiteUrl(): string {
  const explicit = process.env.CONVEX_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (cloud?.includes(".convex.cloud")) {
    return cloud.replace(".convex.cloud", ".convex.site").replace(/\/$/, "");
  }
  throw new Error("CONVEX_SITE_URL is required for analysis worker");
}
