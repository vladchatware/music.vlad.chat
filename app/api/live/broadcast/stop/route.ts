import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { EgressClient } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { readEgressControlToken } from "@/lib/live/controlToken";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!await isAuthenticatedNextjs()) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const { controlToken } = await req.json() as { controlToken?: string };
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    return NextResponse.json({ error: "LiveKit is not configured" }, { status: 503 });
  }
  try {
    if (!controlToken) throw new Error("Missing broadcast control token");
    const { egressId } = await readEgressControlToken(controlToken, apiSecret);
    await new EgressClient(url, apiKey, apiSecret).stopEgress(egressId);
    return NextResponse.json({ stopped: true });
  } catch {
    return NextResponse.json({ error: "Unable to stop broadcast" }, { status: 502 });
  }
}
