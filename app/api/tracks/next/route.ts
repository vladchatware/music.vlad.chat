import { NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

import { api } from "@/convex/_generated/api";
import { playbackDebugServer as playbackDebug } from "@/lib/playbackDebugServer";
import { likes, type Track } from "../../../../soundcloud";

export const runtime = "nodejs";

const MIN_DURATION_MS = 25_000;
const MAX_DURATION_MS = 10 * 60 * 1000;
const DEFAULT_FETCH_LIMIT = 60;
const MAX_RECENT_IDS = 32;

const recentIds: number[] = [];

function parseExcludeIds(raw: string | null): Set<number> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((v) => Number.parseInt(v.trim(), 10))
      .filter((v) => Number.isFinite(v) && v > 0),
  );
}

function isPlayableCandidate(track: Track): boolean {
  if (track.streamable !== true) return false;
  if (!Number.isFinite(track.duration)) return false;
  return track.duration >= MIN_DURATION_MS && track.duration <= MAX_DURATION_MS;
}

function pickRandom<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx] ?? null;
}

function rememberTrackId(id: number) {
  recentIds.push(id);
  while (recentIds.length > MAX_RECENT_IDS) {
    recentIds.shift();
  }
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const excludeIds = parseExcludeIds(new URL(req.url).searchParams.get("exclude"));

  let userToken: string | undefined;
  try {
    const token = await convexAuthNextjsToken();
    if (token) {
      userToken = (await fetchQuery(api.users.soundcloudToken, {}, { token })) ?? undefined;
    }
  } catch {
    userToken = undefined;
  }

  const userId = process.env.SOUNDCLOUD_USER_ID;
  if (!userId) {
    return NextResponse.json({ error: "Missing SOUNDCLOUD_USER_ID" }, { status: 500 });
  }

  try {
    playbackDebug("auto_next.route.begin", {
      excludeCount: excludeIds.size,
      hasUserToken: Boolean(userToken),
    });

    const likedTracks = await likes(userId, { limit: String(DEFAULT_FETCH_LIMIT) }, userToken);
    const filtered = likedTracks.filter((track) => {
      if (!isPlayableCandidate(track)) return false;
      if (excludeIds.has(track.id)) return false;
      return true;
    });
    const nonRecent = filtered.filter((track) => !recentIds.includes(track.id));
    const pool = nonRecent.length > 0 ? nonRecent : filtered;
    const selected = pickRandom(pool);

    if (!selected) {
      playbackDebug("auto_next.route.empty", {
        likedCount: likedTracks.length,
        filteredCount: filtered.length,
        nonRecentCount: nonRecent.length,
        elapsedMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "No candidate tracks available" }, { status: 404 });
    }

    rememberTrackId(selected.id);
    playbackDebug("auto_next.route.selected", {
      selectedTrackId: selected.id,
      likedCount: likedTracks.length,
      filteredCount: filtered.length,
      nonRecentCount: nonRecent.length,
      elapsedMs: Date.now() - startedAt,
    });

    return NextResponse.json({ track: selected });
  } catch (error) {
    playbackDebug("auto_next.route.failed", {
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Failed to select next track" }, { status: 502 });
  }
}
