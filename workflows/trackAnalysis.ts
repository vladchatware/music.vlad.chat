import { createWebhook, sleep, RetryableError } from "workflow";

export type WorkerOutcome =
  | { status: "completed" | "done" | "dead" }
  | { status: "busy" | "waiting"; retryAfterMs: number };

async function dispatchTrackAnalysis(
  cacheKey: string,
  callbackUrl: string,
): Promise<WorkerOutcome> {
  "use step";

  const workerUrl = (process.env.ANALYSIS_WORKER_URL ?? "http://localhost:3001")
    .replace(/\/+$/, "");
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  if (!secret) throw new Error("ANALYSIS_SERVICE_SECRET is required");

  const response = await fetch(`${workerUrl}/analysis/process`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ cacheKey, callbackUrl }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new RetryableError(`Analysis worker failed with status ${response.status}`, {
      retryAfter: 5_000,
    });
  }
  const outcome = await response.json() as WorkerOutcome;
  if (outcome.status === "busy" || outcome.status === "waiting") {
    throw new RetryableError(`Worker ${outcome.status}`, {
      retryAfter: outcome.retryAfterMs,
    });
  }
  return outcome;
}
dispatchTrackAnalysis.maxRetries = 20;

export async function trackAnalysisWorkflow(cacheKey: string): Promise<WorkerOutcome> {
  "use workflow";

  using webhook = createWebhook({ respondWith: "manual" });

  const outcome = await dispatchTrackAnalysis(cacheKey, webhook.url);
  if (outcome.status !== "completed" && outcome.status !== "done" && outcome.status !== "dead") {
    return outcome;
  }

  const result = await Promise.race([
    (async () => {
      for await (const request of webhook) {
        const body = await request.json() as WorkerOutcome;
        await request.respondWith(Response.json({ ok: true }));
        return body;
      }
      throw new Error("Webhook closed without callback");
    })(),
    sleep("5m").then(() => ({ status: "dead" as const } satisfies WorkerOutcome)),
  ]);

  return result;
}
