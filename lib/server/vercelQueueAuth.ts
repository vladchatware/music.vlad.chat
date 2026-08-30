import { readFileSync } from "node:fs";
import path from "node:path";

const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

type MintedToken = {
  token: string;
  expiresAtMs: number;
};

export function decodeJwtExpiryMs(token: string, now = Date.now): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

function readProjectIdFromRepoConfig(): string | undefined {
  for (const fileName of ["repo.json", "project.json"]) {
    try {
      const filePath = path.join(process.cwd(), ".vercel", fileName);
      const config = JSON.parse(readFileSync(filePath, "utf8")) as {
        projectId?: unknown;
        id?: unknown;
        projects?: Array<{ id?: unknown }>;
      };
      if (typeof config.projectId === "string" && config.projectId) return config.projectId;
      if (typeof config.id === "string" && config.id) return config.id;
      const firstProject = config.projects?.[0];
      if (typeof firstProject?.id === "string" && firstProject.id) return firstProject.id;
    } catch {
      // Config file absent or unreadable — try the next candidate.
    }
  }
  return undefined;
}

/**
 * Provides short-lived Vercel OIDC tokens for the Vercel Queue API from any
 * long-running environment (the Docker worker, Next.js route handlers).
 * Tokens are minted through the Vercel API with a scoped access token and
 * cached until shortly before expiry, mirroring @vercel/oidc's own
 * off-platform refresh flow. Publisher and consumer must share the same
 * token scope: Queue visibility is partitioned by the token's environment
 * claim, and tokens minted off-platform are always development-scoped.
 */
export class VercelQueueTokenProvider {
  private cached: MintedToken | null = null;
  private minting: Promise<string> | null = null;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async getToken(): Promise<string> {
    const staticToken = process.env.VERCEL_QUEUE_TOKEN;
    if (staticToken) return staticToken;

    if (this.cached && this.cached.expiresAtMs - this.now() > TOKEN_REFRESH_MARGIN_MS) {
      return this.cached.token;
    }
    if (!this.minting) {
      this.minting = this.mint().finally(() => {
        this.minting = null;
      });
    }
    return await this.minting;
  }

  private async mint(): Promise<string> {
    const apiToken = process.env.VERCEL_API_TOKEN;
    if (!apiToken) {
      throw new Error("VERCEL_API_TOKEN (or VERCEL_QUEUE_TOKEN) is required for Vercel Queue auth");
    }
    const projectId = process.env.VERCEL_PROJECT_ID || readProjectIdFromRepoConfig();
    if (!projectId) {
      throw new Error("VERCEL_PROJECT_ID is required for Vercel Queue auth");
    }

    const url = new URL(`https://api.vercel.com/v1/projects/${projectId}/token`);
    url.searchParams.set("source", "vercel-queue-worker");
    const orgId = process.env.VERCEL_ORG_ID;
    if (orgId) url.searchParams.set("teamId", orgId);

    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Vercel OIDC token mint failed (${response.status})`);
    }
    const body = await response.json() as { token?: unknown };
    if (typeof body.token !== "string" || !body.token) {
      throw new Error("Vercel OIDC token mint returned no token");
    }
    const expiresAtMs = decodeJwtExpiryMs(body.token, this.now) ?? this.now() + 60 * 60_000;
    this.cached = { token: body.token, expiresAtMs };
    return body.token;
  }
}
