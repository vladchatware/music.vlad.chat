import { fetchMutation, fetchQuery } from "convex/nextjs";

import { api } from "../../../../../convex/_generated/api";
import { getErrorStatus } from "@/lib/server/httpError";
import { refreshUserToken, resolveTrackStreamUrl } from "../../../../../soundcloud";

async function resolveStreamWithUserRefresh(id: string, convexToken: string) {
  const tokens = await fetchQuery(api.users.soundcloudTokens, {}, { token: convexToken });
  if (!tokens?.accessToken) return resolveTrackStreamUrl(id);

  try {
    return await resolveTrackStreamUrl(id, tokens.accessToken);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : '';
    const isTokenError = getErrorStatus(error) === 401
      || errMsg.includes('token error')
      || errMsg.includes('CDN auth error');
    if (!isTokenError || !tokens.refreshToken) throw error;

    console.log("User SoundCloud token expired, refreshing...");
    const refreshed = await refreshUserToken(tokens.refreshToken);
    await fetchMutation(
      api.users.updateSoundcloudTokens,
      {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      },
      { token: convexToken },
    );
    return resolveTrackStreamUrl(id, refreshed.accessToken);
  }
}

async function resolveStreamWithServiceUser(id: string): Promise<string> {
  // On dev, use the service user token (set via `bun run refresh:service-user`)
  // fetched from the Convex HTTP endpoint.
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  const siteUrl = process.env.CONVEX_SITE_URL
    ?.replace(/\/+$/, "")
    .replace(/\/api$/, "");
  if (secret && siteUrl) {
    try {
      const res = await fetch(`${siteUrl}/soundcloud/service-credentials`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          process.env.SOUNDCLOUD_USER_ID
            ? { soundcloudUserId: process.env.SOUNDCLOUD_USER_ID }
            : {},
        ),
        cache: "no-store",
      });
      if (res.ok) {
        const { accessToken, refreshToken } = await res.json() as { accessToken: string; refreshToken?: string | null };
        try {
          return await resolveTrackStreamUrl(id, accessToken);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : "";
          const isTokenError = getErrorStatus(error) === 401
            || errMsg.includes("token error")
            || errMsg.includes("CDN auth error");
          if (isTokenError && refreshToken) {
            const refreshed = await refreshUserToken(refreshToken);
            return resolveTrackStreamUrl(id, refreshed.accessToken);
          }
          throw error;
        }
      }
    } catch {
      // Fall through to client-credentials auth
    }
  }
  return resolveTrackStreamUrl(id);
}

export async function resolveStreamWithTimeout(
  id: string,
  convexToken?: string,
  timeoutMs = 25_000,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DOMException("Stream resolution timed out", "TimeoutError")),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([
      convexToken
        ? resolveStreamWithUserRefresh(id, convexToken)
        : resolveStreamWithServiceUser(id),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
