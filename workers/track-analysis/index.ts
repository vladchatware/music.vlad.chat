import { AnalysisQueueClient } from "./api";
import { getConvexSiteUrl } from "./config";
import { analyzeInFreshProcess } from "./analysisProcessClient";
import { readAccessToken } from "../../soundcloud";
import { AuthBackoffError, SoundCloudAuthGate } from "./authBackoff";
import { processWithQueueTrace } from "./queueTracing";
import * as Sentry from "@sentry/node";

const configuredTracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1");
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "analysis-worker",
  enableLogs: true,
  enableMetrics: true,
  tracesSampleRate: Number.isFinite(configuredTracesSampleRate)
    ? Math.max(0, Math.min(1, configuredTracesSampleRate))
    : 1,
});

const secret = process.env.ANALYSIS_SERVICE_SECRET;
if (!secret) throw new Error("ANALYSIS_SERVICE_SECRET is required");

const concurrency = Math.max(1, Number.parseInt(process.env.ANALYSIS_WORKER_CONCURRENCY || "1", 10));
const pollMs = Math.max(500, Number.parseInt(process.env.ANALYSIS_WORKER_POLL_MS || "2000", 10));
const queue = new AnalysisQueueClient(getConvexSiteUrl(), secret);
let stopping = false;
let activeJobs = 0;
const authGate = new SoundCloudAuthGate(readAccessToken);
const workerMetricAttributes = { component: "track-analysis-worker" };
const exceptionCaptureIntervalMs = 60_000;
const lastExceptionCapture = new Map<string, number>();

function captureWorkerException(
  operation: string,
  error: unknown,
  extra: Record<string, string | number>,
) {
  const now = Date.now();
  const lastCapturedAt = lastExceptionCapture.get(operation) ?? 0;
  if (now - lastCapturedAt < exceptionCaptureIntervalMs) return;
  lastExceptionCapture.set(operation, now);
  Sentry.captureException(error, {
    tags: { component: "track-analysis-worker", operation },
    extra,
  });
}

function recordWorkerState() {
  Sentry.metrics.gauge("analysis.worker.active_jobs", activeJobs, {
    attributes: workerMetricAttributes,
  });
  Sentry.metrics.gauge("analysis.worker.available_slots", Math.max(0, concurrency - activeJobs), {
    attributes: workerMetricAttributes,
  });
}

const heartbeat = setInterval(() => {
  Sentry.metrics.count("analysis.worker.heartbeat", 1, { attributes: workerMetricAttributes });
  recordWorkerState();
}, 60_000);
heartbeat.unref?.();

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
    try {
      const claimedJob = await queue.claim();
      if (!claimedJob) {
        await wait(pollMs + Math.floor(Math.random() * Math.min(1000, pollMs)));
        continue;
      }
      const { soundCloudAccessToken, ...job } = claimedJob;
      activeJobs += 1;
      recordWorkerState();
      console.info("analysis.job.started", { slot, trackId: job.sourceTrackId, attempt: job.attempt });
      try {
        await processWithQueueTrace(job, async () => {
          let accessToken = soundCloudAccessToken;
          if (!accessToken) {
            try {
              accessToken = await authGate.acquire();
            } catch (error) {
              const retryMs = error instanceof AuthBackoffError ? error.retryMs : 30_000;
              console.error("analysis.worker.auth_failed", {
                slot,
                retryMs,
                retryAt: new Date(Date.now() + retryMs).toISOString(),
                message: error instanceof Error ? error.message : String(error),
              });
              captureWorkerException("soundcloud_auth", error, { slot, retryMs });
              Sentry.metrics.count("analysis.worker.auth_error", 1, {
                attributes: workerMetricAttributes,
              });
              await queue.defer(job, retryMs, error);
              // Keep polling: signed-user jobs can proceed while app auth is backed off.
              await waitUnlessStopping(Math.min(pollMs, retryMs));
              return;
            }
          }
          const result = await analyzeInFreshProcess(job, accessToken);
          await queue.complete(job, result);
          console.info("analysis.job.completed", {
            slot,
            trackId: job.sourceTrackId,
            processingTimeMs: result.processingTimeMs,
          });
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("analysis.job.failed", {
          slot,
          trackId: job.sourceTrackId,
          message: errorMsg,
        });
        const isNonStreamable = errorMsg.includes("[NON_STREAMABLE]");
        if (!isNonStreamable) {
          captureWorkerException("analyze", error, {
            slot,
            trackId: job.sourceTrackId,
            attempt: job.attempt,
          });
        }
        Sentry.metrics.count("analysis.worker.job_error", 1, {
          attributes: workerMetricAttributes,
        });
        await queue.fail(job, error, isNonStreamable);
      } finally {
        activeJobs -= 1;
        recordWorkerState();
      }
    } catch (error) {
      console.error("analysis.worker.poll_failed", {
        slot,
        message: error instanceof Error ? error.message : String(error),
      });
      captureWorkerException("queue_poll", error, { slot });
      Sentry.metrics.count("analysis.worker.poll_error", 1, {
        attributes: workerMetricAttributes,
      });
      await wait(pollMs);
    }
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  console.info("analysis.worker.stopping", { signal, activeJobs });
  while (activeJobs > 0) await wait(100);
  server.stop(true);
  Sentry.metrics.count("analysis.worker.stopped", 1, {
    attributes: { ...workerMetricAttributes, signal },
  });
  await Sentry.flush(2_000);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.info("analysis.worker.started", { concurrency, port: server.port });
Sentry.logger.info("Track analysis worker started", { concurrency, port: server.port });
Sentry.metrics.count("analysis.worker.started", 1, { attributes: workerMetricAttributes });
recordWorkerState();
await Promise.all(Array.from({ length: concurrency }, (_, slot) => runSlot(slot)));
