import { appendPlaybackLogs, type PlaybackLogEntry } from "./playbackLogStore";

type DebugPayload = Record<string, unknown> | undefined;

const isTruthyFlag = (value: string | null | undefined) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

export const isServerPlaybackDebugEnabled = () => {
  if (process.env.NODE_ENV !== "production") return true;
  return (
    isTruthyFlag(process.env.NEXT_PUBLIC_PLAYER_DEBUG) || isTruthyFlag(process.env.PLAYBACK_DEBUG)
  );
};

export const playbackDebugServer = (event: string, payload?: DebugPayload) => {
  if (!isServerPlaybackDebugEnabled()) return;

  const entry: PlaybackLogEntry = {
    ts: new Date().toISOString(),
    event,
    payload,
  };

  if (payload !== undefined) {
    console.log(`[mp-debug] ${event}`, payload);
  } else {
    console.log(`[mp-debug] ${event}`);
  }

  void appendPlaybackLogs([entry], "server");
};
