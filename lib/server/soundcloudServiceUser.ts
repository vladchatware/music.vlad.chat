export type ServiceSoundCloudCredentials = {
  accessToken: string
  refreshToken: string | null
}

export class ServiceSoundCloudCredentialsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "ServiceSoundCloudCredentialsError"
  }
}

function convexSiteUrl(): string {
  const configured = process.env.CONVEX_SITE_URL
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL
  const url = configured
    ? configured.replace(/\/+$/, "").replace(/\/api$/, "")
    : cloud?.includes(".convex.cloud")
      ? cloud.replace(".convex.cloud", ".convex.site").replace(/\/$/, "")
      : null
  if (!url) {
    throw new ServiceSoundCloudCredentialsError("CONVEX_SITE_URL is not configured", 500)
  }
  return url
}

async function request(path: string, body: unknown): Promise<Response> {
  const secret = process.env.ANALYSIS_SERVICE_SECRET
  if (!secret) {
    throw new ServiceSoundCloudCredentialsError(
      "ANALYSIS_SERVICE_SECRET is not configured",
      500,
    )
  }
  return fetch(`${convexSiteUrl()}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })
}

export async function getServiceSoundCloudCredentials(
  soundcloudUserId: string,
): Promise<ServiceSoundCloudCredentials> {
  const response = await request("/soundcloud/service-credentials", { soundcloudUserId })
  const payload = await response.json().catch(() => null) as
    | { accessToken?: unknown; refreshToken?: unknown; error?: unknown }
    | null
  if (!response.ok) {
    throw new ServiceSoundCloudCredentialsError(
      typeof payload?.error === "string" ? payload.error : "Service user credential lookup failed",
      response.status,
    )
  }
  if (typeof payload?.accessToken !== "string") {
    throw new ServiceSoundCloudCredentialsError(
      "Service user has no stored SoundCloud access token",
      401,
    )
  }
  return {
    accessToken: payload.accessToken,
    refreshToken: typeof payload.refreshToken === "string" ? payload.refreshToken : null,
  }
}

export async function updateServiceSoundCloudCredentials(
  soundcloudUserId: string,
  credentials: ServiceSoundCloudCredentials,
): Promise<void> {
  const response = await request("/soundcloud/service-credentials/update", {
    soundcloudUserId,
    ...credentials,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null
    throw new ServiceSoundCloudCredentialsError(
      typeof payload?.error === "string" ? payload.error : "Service user credential update failed",
      response.status,
    )
  }
}
