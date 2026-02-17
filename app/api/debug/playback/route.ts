import { NextResponse } from "next/server";

import {
  appendPlaybackLogs,
  getPlaybackLogFilePath,
  type PlaybackLogEntry,
  readPlaybackLogsTail,
} from "@/lib/playbackLogStore";

export const runtime = "nodejs";

const MAX_BATCH_SIZE = 250;

function normalizeEntries(rawEvents: unknown[]): PlaybackLogEntry[] {
  const normalized: PlaybackLogEntry[] = [];
  for (const raw of rawEvents) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.event !== "string" || candidate.event.length === 0) continue;
    normalized.push({
      ts: typeof candidate.ts === "string" ? candidate.ts : new Date().toISOString(),
      event: candidate.event,
      payload:
        candidate.payload && typeof candidate.payload === "object"
          ? (candidate.payload as Record<string, unknown>)
          : undefined,
    });
    if (normalized.length >= MAX_BATCH_SIZE) break;
  }
  return normalized;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const source =
    body && typeof body.source === "string" && body.source.length > 0 ? body.source : "client";
  const events = normalizeEntries(Array.isArray(body?.events) ? body.events : []);
  if (events.length === 0) {
    return NextResponse.json({ error: "No valid events" }, { status: 400 });
  }

  await appendPlaybackLogs(events, source);
  return NextResponse.json({
    ok: true,
    written: events.length,
    path: getPlaybackLogFilePath(),
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "200", 10);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 2000)
      : 200;

  const entries = await readPlaybackLogsTail(limit);
  return NextResponse.json({
    ok: true,
    path: getPlaybackLogFilePath(),
    count: entries.length,
    entries,
  });
}
