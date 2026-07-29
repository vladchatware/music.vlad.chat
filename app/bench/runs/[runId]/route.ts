import { resolve } from "node:path";

import { renderBenchRunDetail } from "@/scripts/dj-bench/runDetail";
import { readBenchSummaries, readBenchTrace } from "@/scripts/dj-bench/reportStore";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const root = resolve(process.cwd(), "logs", "dj-bench");
  const run = readBenchSummaries(root).find(
    (candidate) => candidate.runId === runId,
  );
  if (!run) {
    return new Response("DJ bench run not found.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(renderBenchRunDetail(run, readBenchTrace(root, runId)), {
    headers,
  });
}
