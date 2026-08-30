export const ANALYSIS_QUEUE_TOPIC_DEFAULT = "track-analysis";
export const ANALYSIS_QUEUE_RETENTION_SECONDS = 86_400;

export type AnalysisTraceContext = {
  trackId: string;
  sentryTrace?: string;
  sentryBaggage?: string;
  messageId: string;
  messageBodySize: number;
  sentAt: number;
};

export type TrackAnalysisQueueMessage = {
  trackId: string;
  analysisVersion: string;
  priority: number;
  force?: boolean;
  soundcloudUserId?: string;
  requestedBy?: string;
  traceContext?: AnalysisTraceContext;
};

export function trackAnalysisCacheKey(trackId: string, analysisVersion: string): string {
  return `soundcloud:${trackId}:${analysisVersion}`;
}

export function parseTrackAnalysisQueueMessage(message: unknown): TrackAnalysisQueueMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const candidate = message as Record<string, unknown>;
  if (typeof candidate.trackId !== "string" || !/^\d+$/.test(candidate.trackId)) return null;
  if (typeof candidate.analysisVersion !== "string" || !/^[a-z0-9-]{1,64}$/i.test(candidate.analysisVersion)) {
    return null;
  }
  const priority = typeof candidate.priority === "number" && Number.isFinite(candidate.priority)
    ? candidate.priority
    : 0;
  return {
    trackId: candidate.trackId,
    analysisVersion: candidate.analysisVersion,
    priority,
    ...(candidate.force === true ? { force: true } : {}),
    ...(typeof candidate.soundcloudUserId === "string" && candidate.soundcloudUserId
      ? { soundcloudUserId: candidate.soundcloudUserId }
      : {}),
    ...(typeof candidate.requestedBy === "string" && candidate.requestedBy
      ? { requestedBy: candidate.requestedBy }
      : {}),
    ...(isTraceContext(candidate.traceContext) ? { traceContext: candidate.traceContext } : {}),
  };
}

function isTraceContext(value: unknown): value is AnalysisTraceContext {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.trackId === "string"
    && typeof candidate.messageId === "string"
    && typeof candidate.messageBodySize === "number"
    && typeof candidate.sentAt === "number";
}
