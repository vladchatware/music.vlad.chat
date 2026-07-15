import { AnalysisQueueClient } from "./api";
import { getConvexSiteUrl } from "./config";
import { analyzeInFreshProcess } from "./analysisProcessClient";
import { readAccessToken } from "../../soundcloud";
import { AuthBackoffError, SoundCloudAuthGate } from "./authBackoff";

const secret = process.env.ANALYSIS_SERVICE_SECRET;
if (!secret) throw new Error("ANALYSIS_SERVICE_SECRET is required");

const concurrency = Math.max(1, Number.parseInt(process.env.ANALYSIS_WORKER_CONCURRENCY || "1", 10));
const pollMs = Math.max(500, Number.parseInt(process.env.ANALYSIS_WORKER_POLL_MS || "2000", 10));
const queue = new AnalysisQueueClient(getConvexSiteUrl(), secret);
let stopping = false;
let activeJobs = 0;
const authGate = new SoundCloudAuthGate(readAccessToken);

const server = Bun.serve({
  port: Number.parseInt(process.env.PORT || "3001", 10),
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/health") {
      return Response.json({
        ok: !stopping,
        activeJobs,
        soundCloudAuth: authGate.snapshot(),
      }, { status: stopping ? 503 : 200 });
    }
    return new Response("Not found", { status: 404 });
  },
});

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUnlessStopping(ms: number) {
  const deadline = Date.now() + ms;
  while (!stopping && Date.now() < deadline) {
    await wait(Math.min(1_000, deadline - Date.now()));
  }
}

async function runSlot(slot: number) {
  while (!stopping) {
    let accessToken: string;
    try {
      // Authenticate before claiming. A global SoundCloud auth outage must not
      // consume retry attempts across the whole queue.
      accessToken = await authGate.acquire();
    } catch (error) {
      const retryMs = error instanceof AuthBackoffError ? error.retryMs : 30_000;
      console.error("analysis.worker.auth_failed", {
        slot,
        retryMs,
        retryAt: new Date(Date.now() + retryMs).toISOString(),
        message: error instanceof Error ? error.message : String(error),
      });
      await waitUnlessStopping(retryMs);
      continue;
    }

    try {
      const job = await queue.claim();
      if (!job) {
        await wait(pollMs + Math.floor(Math.random() * Math.min(1000, pollMs)));
        continue;
      }
      activeJobs += 1;
      console.info("analysis.job.started", { slot, trackId: job.sourceTrackId, attempt: job.attempt });
      try {
        const result = await analyzeInFreshProcess(job, accessToken);
        await queue.complete(job, result);
        console.info("analysis.job.completed", {
          slot,
          trackId: job.sourceTrackId,
          processingTimeMs: result.processingTimeMs,
        });
      } catch (error) {
        console.error("analysis.job.failed", {
          slot,
          trackId: job.sourceTrackId,
          message: error instanceof Error ? error.message : String(error),
        });
        await queue.fail(job, error);
      } finally {
        activeJobs -= 1;
      }
    } catch (error) {
      console.error("analysis.worker.poll_failed", {
        slot,
        message: error instanceof Error ? error.message : String(error),
      });
      await wait(pollMs);
    }
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info("analysis.worker.stopping", { signal, activeJobs });
  while (activeJobs > 0) await wait(100);
  server.stop(true);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.info("analysis.worker.started", { concurrency, port: server.port });
await Promise.all(Array.from({ length: concurrency }, (_, slot) => runSlot(slot)));
