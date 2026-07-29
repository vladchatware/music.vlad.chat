import { fetch as fetchWorkflow, sleep } from "workflow";

type WorkerOutcome =
  | { status: "completed" | "done" | "dead" }
  | { status: "busy" | "waiting"; retryAfterMs: number };

async function dispatchTrackAnalysis(cacheKey: string): Promise<WorkerOutcome> {
  "use step";

  const workerUrl = (process.env.ANALYSIS_WORKER_URL ?? "http://localhost:3001")
    .replace(/\/+$/, "");
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  if (!secret) throw new Error("ANALYSIS_SERVICE_SECRET is required");

  const response = await fetchWorkflow(`${workerUrl}/analysis/process`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ cacheKey }),
  });
  if (!response.ok) {
    throw new Error(`Analysis worker failed with status ${response.status}`);
  }
  return await response.json() as WorkerOutcome;
}

export async function trackAnalysisWorkflow(cacheKey: string): Promise<WorkerOutcome> {
  "use workflow";

  while (true) {
    const outcome = await dispatchTrackAnalysis(cacheKey);
    if (outcome.status !== "busy" && outcome.status !== "waiting") {
      return outcome;
    }
    await sleep(Math.max(1_000, Math.min(30 * 60_000, outcome.retryAfterMs)));
  }
}
