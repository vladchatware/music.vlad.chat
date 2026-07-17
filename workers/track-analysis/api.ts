import { DEFAULT_LEASE_DURATION_MS } from "./config";
import type { TrackAnalysis } from "../../lib/trackAnalysis";

export type AnalysisJob = {
  cacheKey: string;
  sourceTrackId: string;
  analysisVersion: string;
  attempt: number;
  leaseToken: string;
  soundCloudAccessToken?: string;
  createdAt?: number;
  sentryTrace?: string;
  sentryBaggage?: string;
  messageId?: string;
  messageBodySize?: number;
  sentAt?: number;
};

export class AnalysisQueueClient {
  constructor(
    private readonly siteUrl: string,
    private readonly secret: string,
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.siteUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Analysis queue ${path} failed (${response.status}): ${message.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  async claim(): Promise<AnalysisJob | null> {
    const response = await this.post<{ job: AnalysisJob | null }>("/analysis/claim", {
      leaseDurationMs: DEFAULT_LEASE_DURATION_MS,
    });
    return response.job;
  }

  async enqueue(trackIds: Array<string | number>, priority = 0) {
    return this.post<{ enqueued: number; cached: number; existing: number }>("/analysis/enqueue", {
      trackIds: trackIds.map(String),
      priority,
    });
  }

  async complete(job: AnalysisJob, result: TrackAnalysis): Promise<void> {
    await this.post("/analysis/complete", {
      cacheKey: job.cacheKey,
      leaseToken: job.leaseToken,
      result,
    });
  }

  async fail(job: AnalysisJob, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.post("/analysis/fail", {
      cacheKey: job.cacheKey,
      leaseToken: job.leaseToken,
      error: message.slice(0, 500),
    });
  }

  async defer(job: AnalysisJob, retryMs: number, reason: unknown): Promise<void> {
    const message = reason instanceof Error ? reason.message : String(reason);
    await this.post("/analysis/defer", {
      cacheKey: job.cacheKey,
      leaseToken: job.leaseToken,
      retryMs,
      reason: message.slice(0, 500),
    });
  }
}
