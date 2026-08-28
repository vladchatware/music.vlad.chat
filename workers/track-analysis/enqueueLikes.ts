import { allLikes } from "../../soundcloud";
import { MAX_TRACK_DURATION_SEC } from "./config";

const secret = process.env.ANALYSIS_SERVICE_SECRET;
const soundcloudUserId = process.env.SOUNDCLOUD_USER_ID;
const configuredAppUrl = process.env.ANALYSIS_APP_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");
const appUrl = configuredAppUrl.replace(/\/+$/, "");

if (!secret) throw new Error("ANALYSIS_SERVICE_SECRET is required");
if (!soundcloudUserId) throw new Error("SOUNDCLOUD_USER_ID is required");

const likes = await allLikes(soundcloudUserId);
const eligible = likes.filter((track) =>
  track.streamable
  && Number.isFinite(track.duration)
  && track.duration > 0
  && track.duration <= MAX_TRACK_DURATION_SEC * 1000
);

const totals = { enqueued: 0, cached: 0, existing: 0 };
for (let offset = 0; offset < eligible.length; offset += 20) {
  const response = await fetch(`${appUrl}/api/analysis/enqueue`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      trackIds: eligible.slice(offset, offset + 20).map((track) => track.id),
      priority: 0,
      force: true,
      soundcloudUserId,
    }),
  });
  if (!response.ok) {
    throw new Error(`Analysis enqueue failed (${response.status}): ${await response.text()}`);
  }
  const result = await response.json() as typeof totals;
  totals.enqueued += result.enqueued;
  totals.cached += result.cached;
  totals.existing += result.existing;
}

console.info("analysis.likes_queued", {
  liked: likes.length,
  eligible: eligible.length,
  skipped: likes.length - eligible.length,
  ...totals,
});
