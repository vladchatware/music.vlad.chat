import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwtExpiryMs, VercelQueueTokenProvider } from "./vercelQueueAuth";

const originalEnv = { ...process.env };
const fetchMock = vi.fn();

function makeJwt(expiresInSeconds: number): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ exp: expiresInSeconds })}.signature`;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env = { ...originalEnv };
});

describe("decodeJwtExpiryMs", () => {
  it("extracts the exp claim in milliseconds", () => {
    expect(decodeJwtExpiryMs(makeJwt(1_700_000_000))).toBe(1_700_000_000_000);
  });

  it("returns null for malformed tokens", () => {
    expect(decodeJwtExpiryMs("not-a-jwt")).toBeNull();
    const noExp = `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({})).toString("base64url")}.sig`;
    expect(decodeJwtExpiryMs(noExp)).toBeNull();
  });
});

describe("VercelQueueTokenProvider", () => {
  it("returns a static token without minting", async () => {
    process.env.VERCEL_QUEUE_TOKEN = "static-token";
    const provider = new VercelQueueTokenProvider();

    await expect(provider.getToken()).resolves.toBe("static-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints a token through the Vercel API and caches it until near expiry", async () => {
    process.env.VERCEL_API_TOKEN = "api-token";
    process.env.VERCEL_PROJECT_ID = "prj_test";
    process.env.VERCEL_ORG_ID = "team_test";
    let minted = 0;
    fetchMock.mockImplementation(() => {
      minted += 1;
      return Promise.resolve(new Response(
        JSON.stringify({ token: makeJwt(1_700_000_000) }),
        { status: 200 },
      ));
    });
    const now = vi.fn(() => 1_699_990_000_000);
    const provider = new VercelQueueTokenProvider(now);

    await expect(provider.getToken()).resolves.toBe(makeJwt(1_700_000_000));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://api.vercel.com/v1/projects/prj_test/token");
    expect(String(url)).toContain("teamId=team_test");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer api-token");

    await expect(provider.getToken()).resolves.toBe(makeJwt(1_700_000_000));
    expect(minted).toBe(1);
  });

  it("mints a fresh token once the cached one is near expiry", async () => {
    process.env.VERCEL_API_TOKEN = "api-token";
    process.env.VERCEL_PROJECT_ID = "prj_test";
    fetchMock.mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({ token: makeJwt(1_700_000_000) }),
      { status: 200 },
    )));
    let nowMs = 1_699_990_000_000;
    const provider = new VercelQueueTokenProvider(() => nowMs);

    await provider.getToken();
    nowMs = 1_699_999_800_000;
    await provider.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to .vercel repo config when VERCEL_PROJECT_ID is unset", async () => {
    process.env.VERCEL_API_TOKEN = "api-token";
    delete process.env.VERCEL_PROJECT_ID;
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ token: makeJwt(1_700_000_000) }),
      { status: 200 },
    ));
    const provider = new VercelQueueTokenProvider();

    await provider.getToken();
    expect(String(fetchMock.mock.calls[0][0])).toContain("prj_nxBzeysQga9k9rBtmZQv8NmYdH2f");
  });

  it("rejects when no API token is configured", async () => {
    delete process.env.VERCEL_API_TOKEN;
    delete process.env.VERCEL_QUEUE_TOKEN;
    const provider = new VercelQueueTokenProvider();

    await expect(provider.getToken()).rejects.toThrow("VERCEL_API_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when the mint endpoint fails", async () => {
    process.env.VERCEL_API_TOKEN = "api-token";
    process.env.VERCEL_PROJECT_ID = "prj_test";
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    const provider = new VercelQueueTokenProvider();

    await expect(provider.getToken()).rejects.toThrow("Vercel OIDC token mint failed (403)");
  });
});
