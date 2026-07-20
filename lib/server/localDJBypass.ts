export function isLocalDJBypass(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (process.env.DJ_LOCAL_BYPASS !== "true") return false;
  const hostname = new URL(req.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
