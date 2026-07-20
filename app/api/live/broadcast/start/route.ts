import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import {
  AccessToken,
  EgressClient,
  EncodingOptionsPreset,
  RoomServiceClient,
  StreamOutput,
  StreamProtocol,
} from "livekit-server-sdk";
import { NextResponse } from "next/server";

import { composeRtmpsUrl } from "@/lib/live/rtmps";
import { createEgressControlToken } from "@/lib/live/controlToken";

export const runtime = "nodejs";

function liveKitConfig() {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) throw new Error("LiveKit is not configured");
  return { url, apiKey, apiSecret };
}

export async function POST(req: Request) {
  if (!await isAuthenticatedNextjs()) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      sessionKey?: string;
      serverUrl?: string;
      streamKey?: string;
    };
    if (!body.sessionKey || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.sessionKey)) {
      return NextResponse.json({ error: "Invalid session key" }, { status: 400 });
    }
    const rtmpsUrl = composeRtmpsUrl(body.serverUrl ?? "", body.streamKey ?? "");
    const config = liveKitConfig();
    const roomName = `instagram-${body.sessionKey}`;
    const identity = `broadcaster-${body.sessionKey}`;

    const token = new AccessToken(config.apiKey, config.apiSecret, {
      identity,
      ttl: "2h",
      metadata: JSON.stringify({ sessionKey: body.sessionKey }),
    });
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: false,
      canPublishData: false,
    });

    // Participant Egress can wait for this broadcaster to join and publish,
    // but the room itself must exist before the egress request is submitted.
    const rooms = new RoomServiceClient(config.url, config.apiKey, config.apiSecret);
    await rooms.createRoom({ name: roomName, emptyTimeout: 60 });

    const egress = new EgressClient(config.url, config.apiKey, config.apiSecret);
    const egressInfo = await egress.startParticipantEgress(
      roomName,
      identity,
      {
        stream: new StreamOutput({
          protocol: StreamProtocol.RTMP,
          urls: [rtmpsUrl],
        }),
      },
      { encodingOptions: EncodingOptionsPreset.PORTRAIT_H264_720P_30 },
    );

    return NextResponse.json({
      liveKitUrl: config.url,
      token: await token.toJwt(),
      controlToken: await createEgressControlToken(
        egressInfo.egressId,
        body.sessionKey,
        config.apiSecret,
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start broadcast";
    const safeMessage = message.includes("RTMPS") || message.includes("stream key") ||
      message.includes("server URL") || message.includes("LiveKit is not configured")
      ? message
      : "Unable to start broadcast";
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
