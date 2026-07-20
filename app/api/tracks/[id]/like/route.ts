import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";
import { getErrorStatus } from "@/lib/server/httpError";
import { refreshUserToken, setTrackLiked } from "@/soundcloud";

async function updateLike(id: string, liked: boolean) {
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 });
  }

  let convexToken: string | null = null;
  try {
    convexToken = await convexAuthNextjsToken();
  } catch {}
  if (!convexToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const tokens = await fetchQuery(api.users.soundcloudTokens, {}, { token: convexToken });
  if (!tokens?.accessToken) {
    return NextResponse.json(
      { error: "SoundCloud account not connected", code: "SOUNDCLOUD_NOT_CONNECTED" },
      { status: 403 },
    );
  }

  try {
    await setTrackLiked(id, liked, tokens.accessToken);
  } catch (error) {
    if (getErrorStatus(error) !== 401 || !tokens.refreshToken) throw error;

    const refreshed = await refreshUserToken(tokens.refreshToken);
    await fetchMutation(
      api.users.updateSoundcloudTokens,
      { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken },
      { token: convexToken },
    );
    await setTrackLiked(id, liked, refreshed.accessToken);
  }

  return NextResponse.json({ liked });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return await updateLike(id, true);
  } catch (error) {
    console.error("Failed to like SoundCloud track:", error);
    return NextResponse.json({ error: "Failed to like track" }, { status: 502 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return await updateLike(id, false);
  } catch (error) {
    console.error("Failed to unlike SoundCloud track:", error);
    return NextResponse.json({ error: "Failed to unlike track" }, { status: 502 });
  }
}
