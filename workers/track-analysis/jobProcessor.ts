import type { AnalysisJob, AnalysisQueueClient } from "./api";
import { analyzeInFreshProcess } from "./analysisProcessClient";
import { AuthBackoffError, type SoundCloudAuthGate } from "./authBackoff";
import { processWithQueueTrace } from "./queueTracing";
import * as Sentry from "@sentry/node";

export type ProcessOutcome =
  | { status: "completed" | "done" | "dead" }
  | { status: "busy" | "waiting"; retryAfterMs: number };

export type JobProcessor = (job: AnalysisJob) => Promise<ProcessOutcome>;

export type JobProcessorDeps = {
  queue: AnalysisQueueClient;
  authGate: SoundCloudAuthGate;
  fetchServiceAccessToken: (rotate: boolean) => Promise<string>;
};

const workerMetricAttributes = { component: "track-analysis-worker" };
const exceptionCaptureIntervalMs = 60_000;
const lastExceptionCapture = new Map<string, number>();

export function captureWorkerException(
  operation: string,
  error: unknown,
  extra: Record<string, string | number>,
) {
  const now = Date.now();
  const lastCapturedAt = lastExceptionCapture.get(operation) ?? 0;
  if (now - lastCapturedAt < exceptionCaptureIntervalMs) return;
  lastExceptionCapture.set(operation, now);
  Sentry.captureException(error, {
    tags: { component: "track-analysis-worker", operation },
    extra,
  });
}

export function clampRetryAfterMs(retryAt: number): number {
  return Math.max(1_000, Math.min(30 * 60_000, retryAt - Date.now()));
}

export function createJobProcessor(deps: JobProcessorDeps): JobProcessor {
  async function processJob(job: AnalysisJob): Promise<ProcessOutcome> {
    const { soundCloudAccessToken, ...safeJob } = job;
    console.info("analysis.job.started", {
      trackId: safeJob.sourceTrackId,
      attempt: safeJob.attempt,
    });

    try {
      return await processWithQueueTrace(safeJob, async () => {
        let accessToken = soundCloudAccessToken;
        if (!accessToken) {
          try {
            accessToken = await deps.authGate.acquire();
          } catch (error) {
            const retryMs = error instanceof AuthBackoffError ? error.retryMs : 30_000;
            console.error("analysis.worker.auth_failed", {
              retryMs,
              retryAt: new Date(Date.now() + retryMs).toISOString(),
              message: error instanceof Error ? error.message : String(error),
            });
            captureWorkerException("soundcloud_auth", error, { retryMs });
            Sentry.metrics.count("analysis.worker.auth_error", 1, {
              attributes: workerMetricAttributes,
            });
            await deps.queue.defer(safeJob, retryMs, error);
            return { status: "waiting", retryAfterMs: retryMs };
          }
        }

        const result = await analyzeInFreshProcess(safeJob, accessToken);
        await deps.queue.complete(safeJob, result);
        console.info("analysis.job.completed", {
          trackId: safeJob.sourceTrackId,
          processingTimeMs: result.processingTimeMs,
        });
        return { status: "completed" };
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("analysis.job.failed", {
        trackId: safeJob.sourceTrackId,
        message: errorMsg,
      });
      const isNonStreamable = errorMsg.includes("[NON_STREAMABLE]");
      const isPreviewDecode = errorMsg.includes("[PREVIEW_DECODE]");
      const isTokenError =
        errorMsg.includes("401") ||
        errorMsg.includes("token error") ||
        errorMsg.includes("CDN auth error") ||
        isPreviewDecode;
      if (isTokenError) {
        // Rotate before the retry so it runs with a fresh token.
        try {
          await deps.fetchServiceAccessToken(true);
        } catch (rotateError) {
          console.error("analysis.worker.token_rotate_failed", {
            message: rotateError instanceof Error ? rotateError.message : String(rotateError),
          });
        }
      }
      if (!isNonStreamable && !isPreviewDecode) {
        captureWorkerException("analyze", error, {
          trackId: safeJob.sourceTrackId,
          attempt: safeJob.attempt,
        });
      }
      Sentry.metrics.count("analysis.worker.job_error", 1, {
        attributes: workerMetricAttributes,
      });
      const failure = await deps.queue.fail(safeJob, error, isNonStreamable);
      return failure.dead
        ? { status: "dead" }
        : { status: "waiting", retryAfterMs: clampRetryAfterMs(failure.nextAttemptAt) };
    }
  }

  return processJob;
}
