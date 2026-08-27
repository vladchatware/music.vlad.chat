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
  // Anonymous playback uses the service user's token, obtained from the
  // central token endpoint (which owns the refresh token and persists
  // rotations). On a SoundCloud auth failure we ask it to rotate and retry
  // once — the stored refresh token is single-use.
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  const siteUrl = process.env.CONVEX_SITE_URL
    ?.replace(/\/+$/, "")
    .replace(/\/api$/, "");
  if (!secret || !siteUrl) return resolveTrackStreamUrl(id);

  const fetchAccessToken = async (rotate: boolean) => {
    const res = await fetch(`${siteUrl}/soundcloud/service-access-token`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({
        soundcloudUserId: process.env.SOUNDCLOUD_USER_ID || undefined,
        rotate,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Service access token unavailable (${res.status})`);
    const { accessToken } = await res.json() as { accessToken?: string };
    if (!accessToken) throw new Error("Service access token missing");
    return accessToken;
  };

  try {
    const accessToken = await fetchAccessToken(false);
    try {
      return await resolveTrackStreamUrl(id, accessToken);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "";
      const isTokenError = getErrorStatus(error) === 401
        || errMsg.includes("token error")
        || errMsg.includes("CDN auth error");
      if (!isTokenError) throw error;
      console.log("Service token rejected, rotating…");
      const rotated = await fetchAccessToken(true);
      return await resolveTrackStreamUrl(id, rotated);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "";
    const isTokenError = getErrorStatus(error) === 401
      || errMsg.includes("token error")
      || errMsg.includes("CDN auth error");
    if (!isTokenError) throw error;
    // Fall through to client-credentials (preview) only as a last resort.
    return resolveTrackStreamUrl(id);
  }
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
