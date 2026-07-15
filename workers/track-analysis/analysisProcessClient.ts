import { fileURLToPath } from "node:url";
import type { TrackAnalysis } from "../../lib/trackAnalysis";
import type { AnalysisJob } from "./api";

type ProcessResult =
  | { ok: true; result: TrackAnalysis }
  | { ok: false; error: string };

type AnalysisProcess = {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
};

type SpawnAnalysisProcess = (job: AnalysisJob, accessToken: string) => AnalysisProcess;

export const ANALYSIS_RESULT_MARKER = "__MP_ANALYSIS_RESULT__";

export function spawnAnalysisProcess(job: AnalysisJob, accessToken: string): AnalysisProcess {
  return Bun.spawn(
    [process.execPath, "run", fileURLToPath(new URL("./analysisProcess.ts", import.meta.url))],
    {
      stdin: new Blob([JSON.stringify({ job, accessToken })]),
      stdout: "pipe",
      stderr: "pipe",
    },
  ) as AnalysisProcess;
}

export async function analyzeInFreshProcess(
  job: AnalysisJob,
  accessToken: string,
  spawn: SpawnAnalysisProcess = spawnAnalysisProcess,
): Promise<TrackAnalysis> {
  const child = spawn(job, accessToken);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  let message: ProcessResult | undefined;
  try {
    const markerIndex = stdout.lastIndexOf(ANALYSIS_RESULT_MARKER);
    if (markerIndex >= 0) {
      message = JSON.parse(stdout.slice(markerIndex + ANALYSIS_RESULT_MARKER.length)) as ProcessResult;
    }
  } catch {
    // A native crash can leave stdout empty or truncated.
  }

  // Native runtimes can crash during teardown after producing a valid result.
  // The analysis itself is complete and safe to persist in that case.
  if (message?.ok === true) return message.result;
  if (message?.ok === false) throw new Error(message.error);

  const detail = stderr.trim().replace(/\s+/g, " ").slice(0, 1_000);
  throw new Error(`Analysis process exited ${exitCode}${detail ? `: ${detail}` : ""}`);
}
