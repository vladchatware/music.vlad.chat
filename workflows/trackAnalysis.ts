import { createWebhook, sleep } from "workflow";

export type WorkerOutcome =
  | { status: "completed" | "done" | "dead" }
  | { status: "busy" | "waiting"; retryAfterMs: number };

async function registerCallback(cacheKey: string, callbackUrl: string): Promise<void> {
  "use step";

  const convexUrl = process.env.CONVEX_URL;
  const workerUrl = (process.env.ANALYSIS_WORKER_URL ?? "http://localhost:3001")
    .replace(/\/+$/, "");
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  if (!convexUrl || !secret) throw new Error("CONVEX_URL and ANALYSIS_SERVICE_SECRET required");

  await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      path: "trackAnalysis:setCallbackUrl",
      args: { cacheKey, callbackUrl },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res = await fetch(`${workerUrl}/analysis/process`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ cacheKey }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;
      if (res.status === 409 || res.status === 404) return;
      const body = await res.json() as { retryAfterMs?: number };
      const waitMs = body.retryAfterMs ?? Math.min(5_000 * 2 ** attempt, 120_000);
      await new Promise((r) => setTimeout(r, waitMs));
    } catch {
      const waitMs = Math.min(5_000 * 2 ** attempt, 120_000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

export async function trackAnalysisWorkflow(cacheKey: string): Promise<WorkerOutcome> {
  "use workflow";

  using webhook = createWebhook({ respondWith: "manual" });

  await registerCallback(cacheKey, webhook.url);

  const result = await Promise.race([
    (async () => {
      for await (const request of webhook) {
        const body = await request.json() as WorkerOutcome;
        await request.respondWith(Response.json({ ok: true }));
        return body;
      }
      throw new Error("Webhook closed without callback");
    })(),
    sleep("30m").then(() => ({ status: "dead" as const } satisfies WorkerOutcome)),
  ]);

  return result;
}
