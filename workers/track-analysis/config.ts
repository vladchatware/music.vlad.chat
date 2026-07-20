export const ANALYSIS_SAMPLE_RATE = 22_050;
export const MAX_TRACK_DURATION_SEC = 10 * 60;
export const ENERGY_SAMPLE_RATE = 2;
export const DEFAULT_LEASE_DURATION_MS = 15 * 60_000;

export function getConvexSiteUrl(): string {
  const explicit = process.env.CONVEX_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (cloud?.includes(".convex.cloud")) {
    return cloud.replace(".convex.cloud", ".convex.site").replace(/\/$/, "");
  }
  throw new Error("CONVEX_SITE_URL is required for analysis worker");
}
