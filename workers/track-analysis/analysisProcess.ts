import type { AnalysisJob } from "./api";
import { ANALYSIS_RESULT_MARKER } from "./analysisProcessClient";
import { processAnalysisJob } from "./processJob";

type AnalyzeRequest = { job: AnalysisJob; accessToken: string };

const writeResult = (result: unknown) =>
  Bun.write(Bun.stdout, `${ANALYSIS_RESULT_MARKER}${JSON.stringify(result)}`);

try {
  const request = await new Response(Bun.stdin.stream()).json() as AnalyzeRequest;
  const result = await processAnalysisJob(request.job, {
    soundCloudAccessToken: request.accessToken,
  });
  await writeResult({ ok: true, result });
} catch (error) {
  await writeResult({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
