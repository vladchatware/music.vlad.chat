import { createWebhook, getWorkflowMetadata, sleep } from "workflow";

export type TrackAnalysisWorkflowArgs = {
  trackId: string;
  analysisVersion: string;
  priority: number;
  force?: boolean;
  soundcloudUserId?: string;
  requestedBy?: string;
  traceContext?: {
    trackId: string;
    sentryTrace?: string;
    sentryBaggage?: string;
    messageId: string;
    messageBodySize: number;
    sentAt: number;
  };
};

export type WorkerOutcome =
  | { status: "completed" | "done" | "dead" }
  | { status: "busy" | "waiting"; retryAfterMs: number };

type DispatchOutcome = WorkerOutcome | { status: "accepted" };
type EnqueueOutcome = { enqueued: number; cached: number; existing: number };

async function readOutcome(request: Request): Promise<WorkerOutcome> {
  "use step";
  return request.json() as Promise<WorkerOutcome>;
}

function convexSiteUrl(): string {
  const configured = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "").replace(/\/api$/, "");
  const cloudUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (cloudUrl?.includes(".convex.cloud")) {
    return cloudUrl.replace(".convex.cloud", ".convex.site").replace(/\/+$/, "");
  }
  throw new Error("Convex site URL required");
}

function publicWebhookUrl(webhookUrl: string): string {
  const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!publicSiteUrl) return webhookUrl;
  const webhook = new URL(webhookUrl);
  return new URL(`${webhook.pathname}${webhook.search}`, publicSiteUrl).toString();
}

async function enqueue(
  args: TrackAnalysisWorkflowArgs,
  workflowRunId: string,
): Promise<EnqueueOutcome> {
  "use step";

  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  if (!secret) throw new Error("ANALYSIS_SERVICE_SECRET required");
  const response = await fetch(`${convexSiteUrl()}/analysis/enqueue`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      trackIds: [args.trackId],
      analysisVersion: args.analysisVersion,
      priority: args.priority,
      force: args.force,
      soundcloudUserId: args.soundcloudUserId,
      requestedBy: args.requestedBy,
      workflowRunId,
      traceContexts: args.traceContext ? [args.traceContext] : undefined,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Analysis enqueue failed (${response.status})`);
  return response.json() as Promise<EnqueueOutcome>;
}

async function dispatch(cacheKey: string, callbackUrl: string): Promise<DispatchOutcome> {
  "use step";

  const workerUrl = (process.env.ANALYSIS_WORKER_URL ?? "http://localhost:3001")
    .replace(/\/+$/, "");
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  if (!secret) throw new Error("ANALYSIS_SERVICE_SECRET required");

  const response = await fetch(`${workerUrl}/analysis/process`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ cacheKey, callbackUrl }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json() as DispatchOutcome;
  if (!response.ok && result.status !== "busy" && result.status !== "waiting") {
    throw new Error(`Worker dispatch failed (${response.status})`);
  }
  return result;
}

export async function trackAnalysisWorkflow(
  args: TrackAnalysisWorkflowArgs,
): Promise<WorkerOutcome> {
  "use workflow";

  using webhook = createWebhook();
  const { workflowRunId } = getWorkflowMetadata();
  const queued = await enqueue(args, workflowRunId);
  if (queued.cached > 0 || queued.existing > 0) return { status: "done" };

  const cacheKey = `soundcloud:${args.trackId}:${args.analysisVersion}`;
  const callbackUrl = publicWebhookUrl(webhook.url);
  const requests = webhook[Symbol.asyncIterator]();
  let callbackRequest = requests.next();

  for (;;) {
    const dispatched = await dispatch(cacheKey, callbackUrl);
    if (dispatched.status === "busy" || dispatched.status === "waiting") {
      await sleep(`${Math.ceil(dispatched.retryAfterMs)}ms`);
      continue;
    }
    if (dispatched.status !== "accepted") return dispatched;

    const result = await Promise.race([
      callbackRequest.then(async ({ value: request, done }) => {
        if (done) throw new Error("Webhook closed without callback");
        return readOutcome(request);
      }),
      sleep("30m").then(() => ({ status: "timeout" as const })),
    ]);
    if (result.status === "timeout") continue;
    callbackRequest = requests.next();
    if (result.status === "busy" || result.status === "waiting") {
      if (result.retryAfterMs > 0) await sleep(`${Math.ceil(result.retryAfterMs)}ms`);
      continue;
    }
    return result;
  }
}
