"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/convex/_generated/api";
import MusicPlayer from "@/components/music-player/MusicPlayer";
import type { BroadcastSources } from "./useLiveKitBroadcast";
import { useLiveKitBroadcast } from "./useLiveKitBroadcast";
import { nextSimulatorUsername } from "@/lib/live/dancerMotion";

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 16,
  right: 16,
  zIndex: 20,
  width: 300,
  maxHeight: "calc(100dvh - 32px)",
  overflow: "auto",
  boxSizing: "border-box",
  padding: 16,
  border: "1px solid rgba(255,255,255,.18)",
  borderRadius: 16,
  background: "rgba(8,8,10,.88)",
  color: "white",
  font: "14px/1.35 system-ui, sans-serif",
  backdropFilter: "blur(18px)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  marginTop: 5,
  marginBottom: 10,
  padding: "9px 10px",
  border: "1px solid rgba(255,255,255,.2)",
  borderRadius: 8,
  background: "rgba(255,255,255,.08)",
  color: "white",
};

export function LiveStudio() {
  const [sessionKey, setSessionKey] = useState("");
  const [instagramAccountId, setInstagramAccountId] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [sources, setSources] = useState<BroadcastSources | null>(null);
  const [mockUsername, setMockUsername] = useState("tiny_dancer");
  const [mockComment, setMockComment] = useState("🔥");
  const [studioError, setStudioError] = useState<string | null>(null);
  const isAuthenticated = useQuery(api.auth.isAuthenticated);
  const { signIn } = useAuthActions();
  const prepareSession = useMutation(api.liveStreams.prepareSession);
  const simulateComment = useMutation(api.liveStreams.simulateComment);
  const broadcast = useLiveKitBroadcast();
  const platformSession = useQuery(
    api.liveStreams.getSessionStatus,
    sessionKey ? { sessionKey } : "skip",
  );

  useEffect(() => {
    setSessionKey(`ig_${crypto.randomUUID().replaceAll("-", "")}`);
  }, []);

  const connectEncoder = useCallback(async () => {
    setStudioError(null);
    if (!sources) {
      setStudioError("DJ canvas/audio still initializing");
      return;
    }
    try {
      await prepareSession({ sessionKey, instagramAccountId });
      await broadcast.connect({ sessionKey, serverUrl, streamKey, sources });
      setStreamKey("");
    } catch (error) {
      setStudioError(error instanceof Error ? error.message : "Unable to start Live");
    }
  }, [broadcast, instagramAccountId, prepareSession, serverUrl, sessionKey, sources, streamKey]);

  const disconnectEncoder = useCallback(async () => {
    setStudioError(null);
    try {
      await broadcast.disconnect();
    } catch (error) {
      setStudioError(error instanceof Error ? error.message : "Unable to stop Live");
    }
  }, [broadcast]);

  return (
    <>
      <MusicPlayer
        initialTrackId={2260180544}
        liveSessionKey={sessionKey || undefined}
        onBroadcastSourcesReady={setSources}
        broadcastPortrait
      />
      <aside style={panelStyle} aria-label="Instagram Live studio controls">
        <strong style={{ fontSize: 18 }}>Instagram Live</strong>
        <p style={{ opacity: 0.65, margin: "6px 0 14px" }}>
          Connect encoder here. Start, announcement, and end remain controlled by Instagram.
        </p>
        <p style={{ opacity: 0.75, margin: "0 0 14px" }}>
          Instagram: {platformSession?.platformStatus === "live" ? "live activity detected" : "waiting"}
          <br />Encoder: {broadcast.status}
        </p>

        {isAuthenticated === false ? (
          <button style={inputStyle} onClick={() => void signIn("anonymous")}>
            Sign in to broadcast
          </button>
        ) : (
          <>
            <label>
              Instagram professional account ID
              <input
                style={inputStyle}
                value={instagramAccountId}
                onChange={(event) => setInstagramAccountId(event.target.value)}
                inputMode="numeric"
                placeholder="178414…"
                disabled={broadcast.status === "publishing"}
              />
            </label>
            <label>
              RTMPS server URL
              <input
                style={inputStyle}
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="rtmps://…/rtmp/"
                disabled={broadcast.status === "publishing"}
              />
            </label>
            <label>
              Stream key
              <input
                style={inputStyle}
                type="password"
                value={streamKey}
                onChange={(event) => setStreamKey(event.target.value)}
                autoComplete="off"
                disabled={broadcast.status === "publishing"}
              />
            </label>
            {broadcast.status === "publishing" ? (
              <button style={inputStyle} onClick={() => void disconnectEncoder()}>Disconnect encoder</button>
            ) : (
              <button
                style={inputStyle}
                disabled={broadcast.status === "connecting" || !sources || !sessionKey}
                onClick={() => void connectEncoder()}
              >
                {broadcast.status === "connecting" ? "Connecting…" : "Connect encoder"}
              </button>
            )}

            <hr style={{ borderColor: "rgba(255,255,255,.14)", margin: "14px 0" }} />
            <strong>Comment simulator</strong>
            <input
              style={inputStyle}
              value={mockUsername}
              onChange={(event) => setMockUsername(event.target.value)}
              placeholder="username"
            />
            <input
              style={inputStyle}
              value={mockComment}
              onChange={(event) => setMockComment(event.target.value)}
              placeholder="comment"
            />
            <button
              style={inputStyle}
              disabled={!sessionKey}
              onClick={() => {
                setStudioError(null);
                void simulateComment({
                  sessionKey,
                  username: mockUsername,
                  text: mockComment,
                })
                  .then(() => setMockUsername((current) => nextSimulatorUsername(current)))
                  .catch((error) => setStudioError(error.message));
              }}
            >
              Spawn dancer
            </button>
          </>
        )}
        <output style={{ display: "block", color: studioError || broadcast.error ? "#ff8a8a" : "#8affaa" }}>
          {studioError ?? broadcast.error ?? broadcast.status}
        </output>
      </aside>
    </>
  );
}
