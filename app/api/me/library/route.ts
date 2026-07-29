import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";
import { meLibrary, refreshUserToken } from "@/soundcloud";

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

async function developmentServiceLibrary(soundcloudUserId?: string) {
  // In dev, we can't OAuth against SoundCloud (redirect URI mismatch).
  // Tokens are stored as Convex env vars via `bun run refresh:service-user`
  // and served by the /soundcloud/service-credentials endpoint.
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  if (!secret) throw new Error("ANALYSIS_SERVICE_SECRET not configured");

  const siteUrl = process.env.CONVEX_SITE_URL
    ?.replace(/\/+$/, "")
    .replace(/\/api$/, "");
  if (!siteUrl) throw new Error("CONVEX_SITE_URL not configured");

  const res = await fetch(`${siteUrl}/soundcloud/service-credentials`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(soundcloudUserId ? { soundcloudUserId } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Service credentials request failed (${res.status})`);
  }

  const { accessToken, refreshToken } = await res.json() as { accessToken: string; refreshToken?: string | null };

  try {
    const library = await meLibrary(accessToken);
    return { ...library, source: "service_user" as const };
  } catch (error) {
    const status = errorStatus(error);
    if ((status === 401 || status === 403) && refreshToken) {
      const refreshed = await refreshUserToken(refreshToken);
      const library = await meLibrary(refreshed.accessToken);
      return { ...library, source: "service_user" as const };
    }
    throw error;
  }
}

function serviceUserError(error: unknown) {
  console.error("Failed to load development SoundCloud service user:", error);
  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Could not load SoundCloud service user",
    },
    { status: errorStatus(error) ?? 502 },
  );
}

export async function GET() {
  const isDev = process.env.NODE_ENV === "development";
  const serviceUserId = isDev ? process.env.SOUNDCLOUD_USER_ID : undefined;
  const convexToken = await convexAuthNextjsToken();

  if (!convexToken) {
    if (isDev) {
      try {
        return NextResponse.json(await developmentServiceLibrary(serviceUserId));
      } catch (error) {
        return serviceUserError(error);
      }
    }
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const tokens = await fetchQuery(
    api.users.soundcloudTokens,
    {},
    { token: convexToken },
  );

  if (!tokens?.accessToken) {
    if (isDev) {
      try {
        return NextResponse.json(await developmentServiceLibrary(serviceUserId));
      } catch (error) {
        return serviceUserError(error);
      }
    }
    return NextResponse.json(
      { error: "SoundCloud account not connected", code: "SOUNDCLOUD_NOT_CONNECTED" },
      { status: 401 },
    );
  }

  try {
    return NextResponse.json(await meLibrary(tokens.accessToken));
  } catch (error) {
    const status = errorStatus(error);
    if ((status === 401 || status === 403) && tokens.refreshToken) {
      try {
        const refreshed = await refreshUserToken(tokens.refreshToken);
        await fetchMutation(
          api.users.updateSoundcloudTokens,
          {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
          },
          { token: convexToken },
        );
        return NextResponse.json(await meLibrary(refreshed.accessToken));
      } catch (refreshError) {
        console.error("Failed to refresh SoundCloud library session:", refreshError);
        return NextResponse.json(
          {
            error: "SoundCloud session expired. Please sign in again.",
            code: "TOKEN_EXPIRED",
          },
          { status: 401 },
        );
      }
    }

    console.error("Failed to load SoundCloud library:", error);
    return NextResponse.json(
      { error: "Could not load SoundCloud library" },
      { status: status === 429 ? 429 : 502 },
    );
  }
}
