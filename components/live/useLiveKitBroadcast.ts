"use client";

import { AudioPresets, Room, RoomEvent, Track } from "livekit-client";
import { useCallback, useRef, useState } from "react";

export type BroadcastSources = {
  canvas: HTMLCanvasElement;
  audioStream: MediaStream;
};

type BroadcastStatus = "idle" | "connecting" | "publishing" | "disconnecting" | "error";

export function useLiveKitBroadcast() {
  const roomRef = useRef<Room | null>(null);
  const controlTokenRef = useRef<string | null>(null);
  const tracksRef = useRef<MediaStreamTrack[]>([]);
  const [status, setStatus] = useState<BroadcastStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (args: {
    sessionKey: string;
    serverUrl: string;
    streamKey: string;
    sources: BroadcastSources;
  }) => {
    if (roomRef.current) throw new Error("Broadcast already active");
    setStatus("connecting");
    setError(null);
    try {
      const response = await fetch("/api/live/broadcast/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionKey: args.sessionKey,
          serverUrl: args.serverUrl,
          streamKey: args.streamKey,
        }),
      });
      const config = await response.json() as {
        liveKitUrl?: string;
        token?: string;
        controlToken?: string;
        error?: string;
      };
      if (!response.ok || !config.liveKitUrl || !config.token || !config.controlToken) {
        throw new Error(config.error ?? "Broadcast worker rejected session");
      }
      controlTokenRef.current = config.controlToken;

      const canvasStream = args.sources.canvas.captureStream(30);
      const videoTrack = canvasStream.getVideoTracks()[0];
      const audioTrack = args.sources.audioStream.getAudioTracks()[0];
      if (!videoTrack) throw new Error("Three.js canvas capture unavailable");
      if (!audioTrack) throw new Error("DJ audio capture unavailable");
      videoTrack.contentHint = "motion";
      audioTrack.contentHint = "music";

      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
        publishDefaults: {
          videoCodec: "h264",
          simulcast: false,
          videoEncoding: { maxBitrate: 3_500_000, maxFramerate: 30 },
          audioPreset: AudioPresets.musicHighQualityStereo,
          dtx: false,
          red: true,
        },
      });
      room.on(RoomEvent.Disconnected, () => {
        roomRef.current = null;
        setStatus("idle");
      });
      await room.connect(config.liveKitUrl, config.token);
      await room.localParticipant.publishTrack(videoTrack, {
        source: Track.Source.Camera,
        name: "threejs-program",
      });
      await room.localParticipant.publishTrack(audioTrack, {
        source: Track.Source.Microphone,
        name: "dj-master",
      });
      tracksRef.current = [videoTrack, audioTrack];
      roomRef.current = room;
      setStatus("publishing");
    } catch (caught) {
      for (const track of tracksRef.current) track.stop();
      tracksRef.current = [];
      roomRef.current?.disconnect();
      roomRef.current = null;
      const controlToken = controlTokenRef.current;
      controlTokenRef.current = null;
      if (controlToken) {
        void fetch("/api/live/broadcast/stop", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ controlToken }),
        });
      }
      const message = caught instanceof Error ? caught.message : "Broadcast failed";
      setError(message);
      setStatus("error");
      throw caught;
    }
  }, []);

  const disconnect = useCallback(async () => {
    setStatus("disconnecting");
    const controlToken = controlTokenRef.current;
    controlTokenRef.current = null;
    roomRef.current?.disconnect();
    roomRef.current = null;
    for (const track of tracksRef.current) track.stop();
    tracksRef.current = [];
    if (controlToken) {
      await fetch("/api/live/broadcast/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controlToken }),
      });
    }
    setStatus("idle");
  }, []);

  return { status, error, connect, disconnect };
}
