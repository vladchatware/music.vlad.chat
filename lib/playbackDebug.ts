type DebugPayload = Record<string, unknown> | undefined;

export type PlaybackDebugEntry = {
  ts: string;
  event: string;
  payload?: DebugPayload;
};

declare global {
  interface Window {
    __MUSIC_PLAYER_DEBUG__?: {
      events: PlaybackDebugEntry[];
    };
  }
}

const MAX_EVENT_BUFFER = 800;
const CLIENT_FLUSH_INTERVAL_MS = 1200;
const CLIENT_MAX_BATCH = 80;

let clientFlushTimer: ReturnType<typeof setTimeout> | null = null;
let clientFlushInFlight = false;
let visibilityFlushAttached = false;
const clientPendingEvents: PlaybackDebugEntry[] = [];

const isTruthyFlag = (value: string | null | undefined) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const readBrowserFlag = () => {
  if (typeof window === "undefined") return false;

  let queryEnabled = false;
  try {
    const query = new URLSearchParams(window.location.search).get("mpDebug");
    queryEnabled = isTruthyFlag(query);
  } catch {
    queryEnabled = false;
  }

  let localStorageEnabled = false;
  try {
    localStorageEnabled = isTruthyFlag(window.localStorage.getItem("musicPlayerDebug"));
  } catch {
    localStorageEnabled = false;
  }

  return queryEnabled || localStorageEnabled;
};

export const isPlaybackDebugEnabled = () => {
  const envEnabled =
    isTruthyFlag(process.env.NEXT_PUBLIC_PLAYER_DEBUG) || isTruthyFlag(process.env.PLAYBACK_DEBUG);
  if (typeof window === "undefined") return envEnabled;
  return envEnabled || readBrowserFlag();
};

const flushClientEvents = async () => {
  if (typeof window === "undefined") return;
  if (clientFlushInFlight) return;
  if (clientPendingEvents.length === 0) return;

  clientFlushInFlight = true;
  const batch = clientPendingEvents.splice(0, CLIENT_MAX_BATCH);
  try {
    await fetch("/api/debug/playback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "client", events: batch }),
      keepalive: true,
    });
  } catch {
    clientPendingEvents.unshift(...batch);
  } finally {
    clientFlushInFlight = false;
    if (clientPendingEvents.length > 0) {
      scheduleClientFlush();
    }
  }
};

const scheduleClientFlush = () => {
  if (typeof window === "undefined") return;
  if (clientFlushTimer) return;
  clientFlushTimer = setTimeout(() => {
    clientFlushTimer = null;
    void flushClientEvents();
  }, CLIENT_FLUSH_INTERVAL_MS);
};

const ensureVisibilityFlush = () => {
  if (typeof window === "undefined") return;
  if (visibilityFlushAttached) return;
  visibilityFlushAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushClientEvents();
    }
  });
};

export const playbackDebug = (event: string, payload?: DebugPayload) => {
  if (!isPlaybackDebugEnabled()) return;

  const entry: PlaybackDebugEntry = {
    ts: new Date().toISOString(),
    event,
    payload,
  };

  if (typeof window !== "undefined") {
    if (!window.__MUSIC_PLAYER_DEBUG__) {
      window.__MUSIC_PLAYER_DEBUG__ = { events: [] };
    }
    const events = window.__MUSIC_PLAYER_DEBUG__.events;
    events.push(entry);
    if (events.length > MAX_EVENT_BUFFER) {
      events.shift();
    }

    clientPendingEvents.push(entry);
    if (clientPendingEvents.length >= CLIENT_MAX_BATCH) {
      void flushClientEvents();
    } else {
      scheduleClientFlush();
    }
    ensureVisibilityFlush();
  }

  if (payload !== undefined) {
    console.log(`[mp-debug] ${event}`, payload);
  } else {
    console.log(`[mp-debug] ${event}`);
  }
};

export const flushPlaybackDebugClient = async () => {
  await flushClientEvents();
};

export const clearPlaybackDebugBuffer = () => {
  if (typeof window === "undefined") return;
  if (!window.__MUSIC_PLAYER_DEBUG__) return;
  window.__MUSIC_PLAYER_DEBUG__.events = [];
  clientPendingEvents.length = 0;
};
