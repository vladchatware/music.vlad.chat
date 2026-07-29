import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BENCH_ARTIFACTS,
  isBenchArtifactName,
  resolveBenchArtifact,
} from "@/scripts/dj-bench/artifacts";
import { readBenchSummaries } from "@/scripts/dj-bench/reportStore";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ runId: string; artifact: string }> },
) {
  const { runId, artifact } = await params;
  if (!isBenchArtifactName(artifact)) {
    return new Response("Unknown DJ bench artifact.\n", { status: 404 });
  }
  const root = resolve(process.cwd(), "logs", "dj-bench");
  const runExists = readBenchSummaries(root).some((run) => run.runId === runId);
  const path = runExists ? resolveBenchArtifact(root, runId, artifact) : null;
  if (!path) {
    return new Response("DJ bench artifact not found.\n", { status: 404 });
  }
  const definition = BENCH_ARTIFACTS[artifact];
  const filename = `${runId.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}-${definition.directoryName}`;
  return new Response(readFileSync(path), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": definition.contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
