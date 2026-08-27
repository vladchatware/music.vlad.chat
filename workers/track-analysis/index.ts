import { AnalysisQueueClient, type AnalysisJob } from "./api";
import { getConvexSiteUrl } from "./config";
import { analyzeInFreshProcess } from "./analysisProcessClient";
import { AuthBackoffError, SoundCloudAuthGate } from "./authBackoff";
import { processWithQueueTrace } from "./queueTracing";
import * as Sentry from "@sentry/node";

type ProcessOutcome =
  | { status: "completed" | "done" | "dead" }
  | { status: "busy" | "waiting"; retryAfterMs: number };

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

const concurrency = Math.max(
  1,
  Number.parseInt(process.env.ANALYSIS_WORKER_CONCURRENCY || "1", 10),
);
const queue = new AnalysisQueueClient(getConvexSiteUrl(), secret);
let stopping = false;
let activeJobs = 0;

// Tokens come from the central service-access-token endpoint, which owns the
// refresh token and persists rotations. The worker never holds a refresh
// token and never falls back to client credentials (preview-only access).
const tokenEndpoint = `${getConvexSiteUrl().replace(/\/+$/, "").replace(/\/api$/, "")}/soundcloud/service-access-token`;

async function fetchServiceAccessToken(rotate: boolean): Promise<string> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      soundcloudUserId: process.env.SOUNDCLOUD_USER_ID || undefined,
      rotate,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Service access token unavailable (${res.status})`);
  const { accessToken } = await res.json() as { accessToken?: string };
  if (!accessToken) throw new Error("Service access token missing");
  return accessToken;
}

const authGate = new SoundCloudAuthGate(() => fetchServiceAccessToken(false));
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

function retryAfterMs(retryAt: number) {
  return Math.max(1_000, Math.min(30 * 60_000, retryAt - Date.now()));
}

async function processJob(job: AnalysisJob): Promise<ProcessOutcome> {
  const { soundCloudAccessToken, ...safeJob } = job;
  console.info("analysis.job.started", {
    trackId: safeJob.sourceTrackId,
    attempt: safeJob.attempt,
  });

  try {
    return await processWithQueueTrace(safeJob, async () => {
      let accessToken = soundCloudAccessToken;
      if (!accessToken) {
        try {
          accessToken = await authGate.acquire();
        } catch (error) {
          const retryMs = error instanceof AuthBackoffError ? error.retryMs : 30_000;
          console.error("analysis.worker.auth_failed", {
            retryMs,
            retryAt: new Date(Date.now() + retryMs).toISOString(),
            message: error instanceof Error ? error.message : String(error),
          });
          captureWorkerException("soundcloud_auth", error, { retryMs });
          Sentry.metrics.count("analysis.worker.auth_error", 1, {
            attributes: workerMetricAttributes,
          });
          await queue.defer(safeJob, retryMs, error);
          return { status: "waiting", retryAfterMs: retryMs };
        }
      }

      const result = await analyzeInFreshProcess(safeJob, accessToken);
      await queue.complete(safeJob, result);
      console.info("analysis.job.completed", {
        trackId: safeJob.sourceTrackId,
        processingTimeMs: result.processingTimeMs,
      });
      return { status: "completed" };
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("analysis.job.failed", {
      trackId: safeJob.sourceTrackId,
      message: errorMsg,
    });
    const isNonStreamable = errorMsg.includes("[NON_STREAMABLE]");
    const isPreviewDecode = errorMsg.includes("[PREVIEW_DECODE]");
    const isTokenError =
      errorMsg.includes("401") ||
      errorMsg.includes("token error") ||
      errorMsg.includes("CDN auth error") ||
      isPreviewDecode;
    if (isTokenError) {
      // Rotate before the retry so it runs with a fresh token.
      try {
        await fetchServiceAccessToken(true);
      } catch (rotateError) {
        console.error("analysis.worker.token_rotate_failed", {
          message: rotateError instanceof Error ? rotateError.message : String(rotateError),
        });
      }
    }
    if (!isNonStreamable && !isPreviewDecode) {
      captureWorkerException("analyze", error, {
        trackId: safeJob.sourceTrackId,
        attempt: safeJob.attempt,
      });
    }
    Sentry.metrics.count("analysis.worker.job_error", 1, {
      attributes: workerMetricAttributes,
    });
    const failure = await queue.fail(safeJob, error, isNonStreamable);
    return failure.dead
      ? { status: "dead" }
      : { status: "waiting", retryAfterMs: retryAfterMs(failure.nextAttemptAt) };
  }
}

async function handleProcessRequest(req: Request): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (stopping) {
    return Response.json({ status: "busy", retryAfterMs: 5_000 }, { status: 503 });
  }
  if (activeJobs >= concurrency) {
    return Response.json({ status: "busy", retryAfterMs: 5_000 } satisfies ProcessOutcome);
  }

  let cacheKey: string;
  try {
    const body = await req.json() as { cacheKey?: string };
    cacheKey = body.cacheKey ?? "";
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!/^soundcloud:\d+:[^:]+$/.test(cacheKey)) {
    return Response.json({ error: "Invalid cacheKey" }, { status: 400 });
  }

  activeJobs += 1;
  recordWorkerState();
  try {
    const claim = await queue.claimSpecific(cacheKey);
    if (claim.status !== "claimed") {
      if (claim.status === "waiting") {
        return Response.json({
          status: "waiting",
          retryAfterMs: retryAfterMs(claim.retryAt),
        } satisfies ProcessOutcome);
      }
      return Response.json({ status: claim.status } satisfies ProcessOutcome);
    }
    return Response.json(await processJob(claim.job));
  } catch (error) {
    console.error("analysis.worker.request_failed", {
      cacheKey,
      message: error instanceof Error ? error.message : String(error),
    });
    captureWorkerException("process_request", error, { cacheKey });
    Sentry.metrics.count("analysis.worker.request_error", 1, {
      attributes: workerMetricAttributes,
    });
    return Response.json({ error: "Analysis processing failed" }, { status: 500 });
  } finally {
    activeJobs -= 1;
    recordWorkerState();
  }
}

const server = Bun.serve({
  port: Number.parseInt(process.env.PORT || "3001", 10),
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/health") {
      return Response.json({
        ok: !stopping,
        activeJobs,
        capacity: concurrency,
        soundCloudAuth: authGate.snapshot(),
      }, { status: stopping ? 503 : 200 });
    }
    if (path === "/analysis/process" && req.method === "POST") {
      return handleProcessRequest(req);
    }
    return new Response("Not found", { status: 404 });
  },
});

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drainLoop(): Promise<void> {
  while (!stopping) {
    if (activeJobs >= concurrency) {
      await wait(1_000);
      continue;
    }
    try {
      const job = await queue.claim();
      if (!job) {
        await wait(30_000);
        continue;
      }
      activeJobs += 1;
      recordWorkerState();
      processJob(job)
        .catch((e) => captureWorkerException("drain_process", e, { cacheKey: job.cacheKey }))
        .finally(() => { activeJobs -= 1; recordWorkerState(); });
    } catch (e) {
      captureWorkerException("drain_claim", e, {});
      await wait(30_000);
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

console.info("analysis.worker.started", { concurrency, port: server.port, mode: "on-demand" });
Sentry.logger.info("Track analysis worker started", {
  concurrency,
  port: server.port,
  mode: "on-demand",
});
Sentry.metrics.count("analysis.worker.started", 1, { attributes: workerMetricAttributes });
recordWorkerState();
drainLoop();
