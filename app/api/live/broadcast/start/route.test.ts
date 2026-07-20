import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  startEgress: vi.fn(),
  addGrant: vi.fn(),
  toJwt: vi.fn(),
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  isAuthenticatedNextjs: mocks.authenticated,
}));

vi.mock("livekit-server-sdk", () => ({
  AccessToken: class {
    addGrant = mocks.addGrant;
    toJwt = mocks.toJwt;
  },
  EgressClient: class {
    startParticipantEgress = mocks.startEgress;
  },
  StreamOutput: class {
    constructor(public value: unknown) {}
  },
  StreamProtocol: { RTMP: 0 },
  EncodingOptionsPreset: { PORTRAIT_H264_1080P_30: 6 },
}));

import { POST } from "./route";

describe("start Instagram broadcast", () => {
  beforeEach(() => {
    mocks.authenticated.mockResolvedValue(true);
    mocks.startEgress.mockResolvedValue({ egressId: "EG_fixture" });
    mocks.toJwt.mockResolvedValue("livekit-jwt");
    process.env.LIVEKIT_URL = "https://livekit.example.com";
    process.env.LIVEKIT_API_KEY = "api-key";
    process.env.LIVEKIT_API_SECRET = "api-secret";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
  });

  it("starts portrait participant egress without returning RTMPS secret", async () => {
    const response = await POST(new Request("http://localhost/api/live/broadcast/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionKey: "ig_session_123",
        serverUrl: "rtmps://instagram.example.com:443/rtmp/",
        streamKey: "secret-key",
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      liveKitUrl: "https://livekit.example.com",
      token: "livekit-jwt",
    });
    expect(body.controlToken).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("secret-key");
    expect(mocks.startEgress).toHaveBeenCalledWith(
      "instagram-ig_session_123",
      "broadcaster-ig_session_123",
      expect.objectContaining({ stream: expect.anything() }),
      { encodingOptions: 6 },
    );
  });

  it("requires authentication", async () => {
    mocks.authenticated.mockResolvedValue(false);
    const response = await POST(new Request("http://localhost", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect(mocks.startEgress).not.toHaveBeenCalled();
  });
});
