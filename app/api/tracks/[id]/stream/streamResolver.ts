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
        : resolveTrackStreamUrl(id),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
