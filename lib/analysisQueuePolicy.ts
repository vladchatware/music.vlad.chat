export const MAX_ANALYSIS_ATTEMPTS = 3;
export const MAX_ANALYSIS_ERROR_LENGTH = 500;

export function sanitizeAnalysisError(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|client_secret)=([^\s&]+)/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, MAX_ANALYSIS_ERROR_LENGTH);
}

export function getAnalysisRetryPolicy(attempts: number, now: number) {
  const dead = attempts >= MAX_ANALYSIS_ATTEMPTS;
  const retryDelayMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  return {
    dead,
    nextAttemptAt: dead ? Number.MAX_SAFE_INTEGER : now + retryDelayMs,
  };
}
