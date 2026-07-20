export function getMcpClientRequest(request: Request) {
  const cookie = request.headers.get("cookie");

  return {
    url: new URL("/api/mcp", request.url),
    requestInit: cookie ? { headers: { cookie } } : undefined,
  };
}
