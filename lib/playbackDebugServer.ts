import * as Sentry from "@sentry/nextjs";

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
  const attributes = {
    event,
    ...(typeof payload?.chatSessionId === "string"
      ? { conversation_id: payload.chatSessionId }
      : {}),
    ...(typeof payload?.turnId === "string" ? { turn_id: payload.turnId } : {}),
    ...(payload ? { payload: JSON.stringify(payload).slice(0, 8_000) } : {}),
  };
  const isFailure = /error|failed|rejected|unhandled/i.test(event);
  if (isFailure) Sentry.logger.error(`Playback: ${event}`, attributes);
  else Sentry.logger.info(`Playback: ${event}`, attributes);

  if (isServerPlaybackDebugEnabled()) {
    if (payload !== undefined) {
      console.log(`[mp-debug] ${event}`, payload);
    } else {
      console.log(`[mp-debug] ${event}`);
    }
  }
};
