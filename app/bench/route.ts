import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { renderBenchmarkDashboard } from "@/scripts/dj-bench/dashboard";
import { readBenchSummaries } from "@/scripts/dj-bench/reportStore";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
};

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

export async function GET(request: Request) {
  const root = resolve(process.cwd(), "logs", "dj-bench");
  const runs = readBenchSummaries(root);
  const runId = new URL(request.url).searchParams.get("run");

  if (runId) {
    const run = runs.find((candidate) => candidate.runId === runId);
    if (!run) return new Response("DJ bench report not found.\n", { status: 404 });
    const reportPath = resolve(run.reportPath);
    if (!isInside(root, reportPath)) {
      return new Response("DJ bench report path is invalid.\n", { status: 400 });
    }
    try {
      return new Response(readFileSync(reportPath, "utf8"), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    } catch {
      return new Response("DJ bench report file is missing.\n", { status: 404 });
    }
  }

  return new Response(
    renderBenchmarkDashboard(
      root,
      runs,
      (run) => `/bench?run=${encodeURIComponent(run.runId)}`,
    ),
    { headers },
  );
}
