import { resolve } from "node:path";

import { renderBenchmarkDashboard } from "@/scripts/dj-bench/dashboard";
import { readBenchSummaries } from "@/scripts/dj-bench/reportStore";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
};

export async function GET(request: Request) {
  const root = resolve(process.cwd(), "logs", "dj-bench");
  const runs = readBenchSummaries(root);
  const runId = new URL(request.url).searchParams.get("run");

  if (runId) {
    return Response.redirect(
      new URL(`/bench/runs/${encodeURIComponent(runId)}`, request.url),
      307,
    );
  }

  return new Response(
    renderBenchmarkDashboard(
      root,
      runs,
      (run) => `/bench/runs/${encodeURIComponent(run.runId)}`,
    ),
    { headers },
  );
}
