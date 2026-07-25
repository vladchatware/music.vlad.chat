import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";
import {
  getServiceSoundCloudCredentials,
  updateServiceSoundCloudCredentials,
} from "@/lib/server/soundcloudServiceUser";
import { meLibrary, refreshUserToken } from "@/soundcloud";

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

async function developmentDirectLibrary(userToken: string) {
  const library = await meLibrary(userToken);
  return { ...library, source: "service_user" as const };
}

async function developmentServiceLibrary(serviceUserId: string) {
  // In dev, accept a direct user token via env var as the fastest path
  const directToken = process.env.SOUNDCLOUD_DEV_USER_TOKEN;
  if (directToken) {
    return developmentDirectLibrary(directToken);
  }

  const tokens = await getServiceSoundCloudCredentials(serviceUserId);
  try {
    const library = await meLibrary(tokens.accessToken);
    return { ...library, source: "service_user" as const };
  } catch (error) {
    const status = errorStatus(error);
    if ((status !== 401 && status !== 403) || !tokens.refreshToken) throw error;
    const refreshed = await refreshUserToken(tokens.refreshToken);
    await updateServiceSoundCloudCredentials(serviceUserId, refreshed);
    const library = await meLibrary(refreshed.accessToken);
    return { ...library, source: "service_user" as const };
  }
}

function serviceUserError(error: unknown) {
  console.error("Failed to load development SoundCloud service user:", error);
  return NextResponse.json(
    {
      error: error instanceof Error
        ? error.message
        : "Could not load SoundCloud service user",
    },
    { status: errorStatus(error) ?? 502 },
  );
}

export async function GET() {
  const serviceUserId =
    process.env.NODE_ENV === "development" ? process.env.SOUNDCLOUD_USER_ID : undefined;
  const convexToken = await convexAuthNextjsToken();
  if (!convexToken) {
    if (serviceUserId) {
      try {
        return NextResponse.json(await developmentServiceLibrary(serviceUserId));
      } catch (error) {
        return serviceUserError(error);
      }
    }
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const tokens = await fetchQuery(api.users.soundcloudTokens, {}, { token: convexToken });
  if (!tokens?.accessToken) {
    if (serviceUserId) {
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
          { error: "SoundCloud session expired. Please sign in again.", code: "TOKEN_EXPIRED" },
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
