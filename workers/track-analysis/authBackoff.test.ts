import { describe, expect, it, vi } from "vitest";
import { AuthBackoffError, SoundCloudAuthGate } from "./authBackoff";

async function captureFailure(promise: Promise<string>): Promise<AuthBackoffError> {
  try {
    await promise;
    throw new Error("Expected authentication failure");
  } catch (error) {
    if (error instanceof AuthBackoffError) return error;
    throw error;
  }
}

describe("SoundCloud auth circuit breaker", () => {
  it("shares one token request across concurrent worker slots", async () => {
    let resolve!: (token: string) => void;
    const readToken = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const gate = new SoundCloudAuthGate(readToken);

    const first = gate.acquire();
    const second = gate.acquire();
    resolve("token");

    await expect(Promise.all([first, second])).resolves.toEqual(["token", "token"]);
    expect(readToken).toHaveBeenCalledOnce();
  });

  it("backs off exponentially with equal jitter and a production cap", async () => {
    let now = 1_000;
    const readToken = vi.fn(async () => { throw new Error("rate limited"); });
    const gate = new SoundCloudAuthGate(readToken, {
      baseMs: 30_000,
      maxMs: 120_000,
      now: () => now,
      random: () => 1,
    });

    for (const expected of [30_000, 60_000, 120_000, 120_000]) {
      const failure = await captureFailure(gate.acquire());
      expect(failure.retryMs).toBe(expected);
      now += expected;
    }
    expect(readToken).toHaveBeenCalledTimes(4);
  });

  it("honors Retry-After when longer than exponential delay", async () => {
    const error = Object.assign(new Error("rate limited"), { retryAfterMs: 600_000 });
    const gate = new SoundCloudAuthGate(async () => { throw error; }, {
      baseMs: 30_000,
      random: () => 0,
      now: () => 10_000,
    });

    const failure = await captureFailure(gate.acquire());
    expect(failure.retryMs).toBe(600_000);
    expect(gate.snapshot()).toMatchObject({ circuitOpen: true, retryAt: 610_000 });
  });

  it("does not call auth endpoint while circuit remains open", async () => {
    let now = 0;
    const readToken = vi.fn(async () => { throw new Error("rate limited"); });
    const gate = new SoundCloudAuthGate(readToken, { now: () => now, random: () => 1 });
    await gate.acquire().catch(() => undefined);
    now = 1_000;

    const failure = await captureFailure(gate.acquire());
    expect(failure.retryMs).toBe(29_000);
    expect(readToken).toHaveBeenCalledOnce();
  });
});
