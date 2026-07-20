export type RetryableAuthError = Error & { retryAfterMs?: number };

export class AuthBackoffError extends Error {
  constructor(
    message: string,
    readonly retryMs: number,
    readonly retryAt: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthBackoffError";
  }
}

type AuthGateOptions = {
  baseMs?: number;
  maxMs?: number;
  now?: () => number;
  random?: () => number;
};

export class SoundCloudAuthGate {
  private failures = 0;
  private retryAt = 0;
  private inFlight?: Promise<string>;
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(
    private readonly readToken: () => Promise<string | undefined>,
    options: AuthGateOptions = {},
  ) {
    this.baseMs = options.baseMs ?? 30_000;
    this.maxMs = options.maxMs ?? 30 * 60_000;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  acquire(): Promise<string> {
    const now = this.now();
    if (now < this.retryAt) {
      return Promise.reject(new AuthBackoffError(
        "SoundCloud authentication circuit open",
        this.retryAt - now,
        this.retryAt,
      ));
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.readToken()
      .then((token) => {
        if (!token) throw new Error("No SoundCloud access token available");
        this.failures = 0;
        this.retryAt = 0;
        return token;
      })
      .catch((error: RetryableAuthError) => {
        this.failures += 1;
        const exponentialMs = Math.min(
          this.maxMs,
          this.baseMs * (2 ** Math.min(20, this.failures - 1)),
        );
        const jitteredMs = Math.round(exponentialMs * (0.5 + this.random() * 0.5));
        const retryMs = Math.max(jitteredMs, error.retryAfterMs ?? 0);
        this.retryAt = this.now() + retryMs;
        throw new AuthBackoffError(error.message, retryMs, this.retryAt, { cause: error });
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  snapshot() {
    const retryMs = Math.max(0, this.retryAt - this.now());
    return {
      failures: this.failures,
      circuitOpen: retryMs > 0,
      retryAt: retryMs > 0 ? this.retryAt : null,
      retryMs,
    };
  }
}
