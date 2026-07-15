type DebugPayload = Record<string, unknown> | undefined;

export type PlaybackDebugEntry = {
  schemaVersion: 1;
  ts: string;
  sessionId: string;
  sequence: number;
  elapsedMs?: number;
  chatSessionId?: string;
  turnId?: string;
  event: string;
  payload?: DebugPayload;
};

export type PlaybackTelemetrySink = (entry: PlaybackDebugEntry) => void | Promise<void>;

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
let runtimeErrorsAttached = false;
let sequence = 0;
const clientStartedAtMs = typeof performance === "undefined" ? null : performance.now();
const clientPendingEvents: PlaybackDebugEntry[] = [];
const telemetrySinks = new Set<PlaybackTelemetrySink>();
let correlationContext: { chatSessionId?: string; turnId?: string } = {};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const sessionId = createId();

export const getPlaybackDebugSessionId = () => sessionId;

export const setPlaybackDebugCorrelation = (context: {
  chatSessionId?: string;
  turnId?: string;
}) => {
  correlationContext = { ...correlationContext, ...context };
};

/** Bridge point for Sentry, OpenTelemetry, or another telemetry SDK. */
export const addPlaybackTelemetrySink = (sink: PlaybackTelemetrySink) => {
  telemetrySinks.add(sink);
  return () => telemetrySinks.delete(sink);
};

const errorDetails = (value: unknown): Record<string, unknown> => {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return { message: typeof value === "string" ? value : String(value) };
};

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

const ensureRuntimeErrorCapture = () => {
  if (typeof window === "undefined" || runtimeErrorsAttached) return;
  runtimeErrorsAttached = true;
  window.addEventListener("error", (event) => {
    playbackDebug("runtime.window.error", {
      ...errorDetails(event.error ?? event.message),
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    playbackDebug("runtime.promise.unhandled_rejection", errorDetails(event.reason));
  });
};

export const playbackDebug = (event: string, payload?: DebugPayload) => {
  if (!isPlaybackDebugEnabled()) return;

  const entry: PlaybackDebugEntry = {
    schemaVersion: 1,
    ts: new Date().toISOString(),
    sessionId,
    sequence: ++sequence,
    elapsedMs:
      clientStartedAtMs === null || typeof performance === "undefined"
        ? undefined
        : Math.round(performance.now() - clientStartedAtMs),
    ...correlationContext,
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
    ensureRuntimeErrorCapture();
  }

  for (const sink of telemetrySinks) {
    try {
      void Promise.resolve(sink(entry)).catch(() => undefined);
    } catch {
      // Diagnostics must never break playback.
    }
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
