import { afterEach, describe, expect, it, vi } from "vitest";

type McpTestServer = { tool: ReturnType<typeof vi.fn> };

const telemetry = vi.hoisted(() => {
  const server: McpTestServer = { tool: vi.fn() };
  return {
    handler: vi.fn(),
    server,
    wrapMcpServerWithSentry: vi.fn(),
    createMcpHandler: vi.fn((initialize: (server: McpTestServer) => void) => {
      initialize(server);
      return vi.fn();
    }),
  };
});

vi.mock("mcp-handler", () => ({ createMcpHandler: telemetry.createMcpHandler }));
vi.mock("@sentry/node", () => ({
  wrapMcpServerWithSentry: telemetry.wrapMcpServerWithSentry,
}));
vi.mock("../../../soundcloud", () => ({
  likes: vi.fn(),
  playlists: vi.fn(),
  tracks: vi.fn(),
  users: vi.fn(),
}));
vi.mock("@/lib/playbackDebugServer", () => ({ playbackDebugServer: vi.fn() }));
vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }));
vi.mock("../../../convex/_generated/api", () => ({
  api: { users: { soundcloudToken: "soundcloudToken" } },
}));
vi.mock("@convex-dev/auth/nextjs/server", () => ({ convexAuthNextjsToken: vi.fn() }));
vi.mock("@/lib/server/soundcloudCandidateSearch", () => ({ searchTrackCandidates: vi.fn() }));

const originalFlag = process.env.AI_TELEMETRY_RECORD_CONTENT;

afterEach(() => {
  vi.resetModules();
  telemetry.server.tool.mockClear();
  telemetry.wrapMcpServerWithSentry.mockClear();
  telemetry.createMcpHandler.mockClear();
  if (originalFlag === undefined) delete process.env.AI_TELEMETRY_RECORD_CONTENT;
  else process.env.AI_TELEMETRY_RECORD_CONTENT = originalFlag;
});

describe("MCP Sentry instrumentation", () => {
  it.each([
    ["true", true],
    ["false", false],
  ])("wraps the handler server with content recording flag %s", async (flag, enabled) => {
    process.env.AI_TELEMETRY_RECORD_CONTENT = flag;

    await import("./route");

    expect(telemetry.wrapMcpServerWithSentry).toHaveBeenCalledWith(telemetry.server, {
      recordInputs: enabled,
      recordOutputs: enabled,
    });
    expect(telemetry.wrapMcpServerWithSentry.mock.invocationCallOrder[0])
      .toBeLessThan(telemetry.server.tool.mock.invocationCallOrder[0]);
  });

  it("exposes portable DJ analysis and scheduling tools", async () => {
    await import("./route");

    const names = telemetry.server.tool.mock.calls.map(([name]) => name);
    expect(names).toEqual(expect.arrayContaining([
      "likes",
      "tracks",
      "track_analysis",
      "compare_track_analysis",
      "schedule_track_analysis",
    ]));
  });
});
