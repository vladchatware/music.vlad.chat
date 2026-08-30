import { AnalysisQueueClient, type AnalysisJob } from "./api";
import { getConvexSiteUrl, getQueueConsumerGroup, getQueuePollIntervalMs, getQueueRegion, getQueueTopic, isQueueAuthConfigured, QUEUE_SLOT_WAIT_MS, QUEUE_VISIBILITY_TIMEOUT_SECONDS } from "./config";
import { SoundCloudAuthGate } from "./authBackoff";
import { captureWorkerException, clampRetryAfterMs, createJobProcessor, type ProcessOutcome } from "./jobProcessor";
import { createQueueMessageHandler, runQueueSlot } from "./queueConsumer";
import { VercelQueueTokenProvider } from "./vercelQueueAuth";
import * as Sentry from "@sentry/node";

type DispatchOutcome = ProcessOutcome | { status: "accepted" };

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
  Number.parseInt(process.env.ANALYSIS_WORKER_CONCURRENCY || "2", 10),
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
const processJob = createJobProcessor({ queue, authGate, fetchServiceAccessToken });
const workerMetricAttributes = { component: "track-analysis-worker" };

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

async function postToCallback(callbackUrl: string | undefined, outcome: ProcessOutcome) {
  if (!callbackUrl) return;
  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(outcome),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Callback failed (${response.status})`);
  } catch (error) {
    console.error("analysis.worker.callback_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
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
    return Response.json({ status: "busy", retryAfterMs: 5_000 + Math.random() * 10_000 } satisfies ProcessOutcome);
  }

  let cacheKey: string;
  let callbackUrl: string | undefined;
  try {
    const body = await req.json() as { cacheKey?: string; callbackUrl?: string };
    cacheKey = body.cacheKey ?? "";
    callbackUrl = body.callbackUrl;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!/^soundcloud:\d+:[^:]+$/.test(cacheKey)) {
    return Response.json({ error: "Invalid cacheKey" }, { status: 400 });
  }
  activeJobs += 1;
  recordWorkerState();
  let slotTransferred = false;
  try {
    const claim = await queue.claimSpecific(cacheKey);
    if (claim.status !== "claimed") {
      if (claim.status === "waiting") {
        return Response.json({
          status: "waiting",
          retryAfterMs: clampRetryAfterMs(claim.retryAt),
        } satisfies ProcessOutcome);
      }
      return Response.json({ status: claim.status } satisfies ProcessOutcome);
    }

    callbackUrl ??= claim.job.callbackUrl;
    if (callbackUrl) {
      try {
        const callback = new URL(callbackUrl);
        const localHttp = callback.protocol === "http:" && callback.hostname === "localhost";
        if (callback.protocol !== "https:" && !localHttp) throw new Error("Invalid protocol");
      } catch {
        callbackUrl = undefined;
      }
    }

    slotTransferred = true;
    void processJob(claim.job)
      .then((outcome) => postToCallback(callbackUrl, outcome))
      .catch((error) => {
        console.error("analysis.worker.background_job_failed", {
          cacheKey,
          message: error instanceof Error ? error.message : String(error),
        });
        return postToCallback(callbackUrl, { status: "waiting", retryAfterMs: 0 });
      })
      .finally(() => {
        activeJobs -= 1;
        recordWorkerState();
      });
    return Response.json({ status: "accepted" } satisfies DispatchOutcome);
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
    if (!slotTransferred) {
      activeJobs -= 1;
      recordWorkerState();
    }
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
        queueConsumer: queueConsumerStarted,
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

let queueConsumerStarted = false;

function startQueueConsumer() {
  if (!isQueueAuthConfigured()) {
    console.info("analysis.worker.queue_consumer_disabled", {
      reason: "VERCEL_API_TOKEN or VERCEL_QUEUE_TOKEN not configured",
    });
    return;
  }
  const handleMessage = createQueueMessageHandler({ convexQueue: queue, processJob });
  const tokenProvider = new VercelQueueTokenProvider();
  const slotOptions = {
    tokenProvider,
    region: getQueueRegion(),
    topic: getQueueTopic(),
    consumerGroup: getQueueConsumerGroup(),
    visibilityTimeoutSeconds: QUEUE_VISIBILITY_TIMEOUT_SECONDS,
    pollIntervalMs: getQueuePollIntervalMs(),
    slotWaitMs: QUEUE_SLOT_WAIT_MS,
    handleMessage,
    acquireSlot: () => {
      if (stopping || activeJobs >= concurrency) return false;
      activeJobs += 1;
      recordWorkerState();
      return true;
    },
    releaseSlot: () => {
      activeJobs -= 1;
      recordWorkerState();
    },
    isStopping: () => stopping,
  };
  for (let slot = 0; slot < concurrency; slot += 1) {
    void runQueueSlot(slotOptions);
  }
  queueConsumerStarted = true;
  console.info("analysis.worker.queue_consumer_started", {
    region: slotOptions.region,
    topic: slotOptions.topic,
    consumerGroup: slotOptions.consumerGroup,
    slots: concurrency,
  });
  Sentry.logger.info("Track analysis queue consumer started", {
    region: slotOptions.region,
    topic: slotOptions.topic,
    consumerGroup: slotOptions.consumerGroup,
  });
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

startQueueConsumer();

console.info("analysis.worker.started", {
  concurrency,
  port: server.port,
  mode: "on-demand",
  queueConsumer: queueConsumerStarted,
});
Sentry.logger.info("Track analysis worker started", {
  concurrency,
  port: server.port,
  mode: "on-demand",
  queueConsumer: queueConsumerStarted,
});
Sentry.metrics.count("analysis.worker.started", 1, { attributes: workerMetricAttributes });
recordWorkerState();
