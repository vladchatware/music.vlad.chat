import { allLikes } from "../../soundcloud";
import { AnalysisQueueClient } from "./api";
import { MAX_TRACK_DURATION_SEC, getConvexSiteUrl } from "./config";

const secret = process.env.ANALYSIS_SERVICE_SECRET;
const soundcloudUserId = process.env.SOUNDCLOUD_USER_ID;
if (!secret) throw new Error("ANALYSIS_SERVICE_SECRET is required");
if (!soundcloudUserId) throw new Error("SOUNDCLOUD_USER_ID is required");

const queue = new AnalysisQueueClient(getConvexSiteUrl(), secret);
const likes = await allLikes(soundcloudUserId);
const eligible = likes.filter((track) =>
  track.streamable &&
  Number.isFinite(track.duration) &&
  track.duration > 0 &&
  track.duration <= MAX_TRACK_DURATION_SEC * 1000
);

const totals = { enqueued: 0, cached: 0, existing: 0 };
for (let offset = 0; offset < eligible.length; offset += 20) {
  const result = await queue.enqueue(
    eligible.slice(offset, offset + 20).map((track) => track.id),
    0,
    undefined,
    soundcloudUserId,
  );
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
