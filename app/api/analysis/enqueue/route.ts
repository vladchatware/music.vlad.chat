import { enqueueTrackAnalyses } from "@/lib/server/analysisQueue";

export async function POST(req: Request) {
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawTrackIds = Array.isArray(body.trackIds) ? body.trackIds : [body.trackId];
  const trackIds = (rawTrackIds as Array<string | number>)
    .map((id) => String(id ?? ""))
    .filter((id) => /^\d+$/.test(id));
  if (trackIds.length === 0 || trackIds.length > 20) {
    return Response.json(
      { error: "trackIds must contain 1-20 positive numeric IDs" },
      { status: 400 },
    );
  }

  const result = await enqueueTrackAnalyses(
    trackIds,
    Number.isFinite(body.priority) ? Number(body.priority) : 0,
    undefined,
    body.force === true,
    typeof body.soundcloudUserId === "string" ? body.soundcloudUserId : undefined,
  );
  if (!result) {
    return Response.json({ error: "Analysis queue is disabled" }, { status: 503 });
  }
  return Response.json(result);
}
