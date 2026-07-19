export function composeRtmpsUrl(serverUrl: string, streamKey: string): string {
  const server = serverUrl.trim();
  const key = streamKey.trim();
  if (!key) throw new Error("Instagram stream key required");
  let parsed: URL;
  try {
    parsed = new URL(server);
  } catch {
    throw new Error("Invalid Instagram server URL");
  }
  if (parsed.protocol !== "rtmps:") throw new Error("Instagram server must use RTMPS");
  if (parsed.username || parsed.password) throw new Error("Credentials are not allowed in server URL");
  if (parsed.search || parsed.hash) throw new Error("Server URL cannot contain query or fragment");
  return `${server.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

export function redactRtmpsUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/…`;
  } catch {
    return "invalid-rtmps-url";
  }
}
