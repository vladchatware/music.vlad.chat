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

const MAX_EVENT_BUFFER = 250;
const MAX_CONSOLE_PAYLOAD_CHARS = 8_000;

let runtimeErrorsAttached = false;
let sequence = 0;
const clientStartedAtMs = typeof performance === "undefined" ? null : performance.now();
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

export const formatPlaybackDebugPayload = (
  payload: DebugPayload,
  maxChars = MAX_CONSOLE_PAYLOAD_CHARS,
) => {
  const seen = new WeakSet<object>();
  let serialized: string;
  try {
    serialized = JSON.stringify(payload, (_key, value: unknown) => {
      if (!value || typeof value !== "object") return value;
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      return value;
    });
  } catch {
    serialized = "[Unserializable payload]";
  }
  if (serialized.length <= maxChars) return serialized;
  return `${serialized.slice(0, Math.max(0, maxChars - 1))}…`;
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

  const debugEnabled = isPlaybackDebugEnabled();
  if (debugEnabled && typeof window !== "undefined") {
    if (!window.__MUSIC_PLAYER_DEBUG__) {
      window.__MUSIC_PLAYER_DEBUG__ = { events: [] };
    }
    const events = window.__MUSIC_PLAYER_DEBUG__.events;
    events.push(entry);
    if (events.length > MAX_EVENT_BUFFER) {
      events.shift();
    }

    ensureRuntimeErrorCapture();
  }

  for (const sink of telemetrySinks) {
    try {
      void Promise.resolve(sink(entry)).catch(() => undefined);
    } catch {
      // Diagnostics must never break playback.
    }
  }

  if (debugEnabled) {
    if (payload !== undefined) {
      console.log(`[mp-debug] ${event} ${formatPlaybackDebugPayload(payload)}`);
    } else {
      console.log(`[mp-debug] ${event}`);
    }
  }
};

export const clearPlaybackDebugBuffer = () => {
  if (typeof window === "undefined") return;
  if (!window.__MUSIC_PLAYER_DEBUG__) return;
  window.__MUSIC_PLAYER_DEBUG__.events = [];
};
