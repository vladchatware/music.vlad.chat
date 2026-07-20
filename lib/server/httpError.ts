export function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = error.status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

export function getErrorRetryAfterMs(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("retryAfterMs" in error)) return null;
  const retryAfterMs = error.retryAfterMs;
  return typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs >= 0
    ? retryAfterMs
    : null;
}
