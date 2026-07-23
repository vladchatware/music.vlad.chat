const MAX_LIVE_STATE_CHARS = 16_000;

export function getDJLiveStateInstruction(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  if (!serialized || serialized === "{}") return null;
  const compact = serialized.length > MAX_LIVE_STATE_CHARS
    ? `${serialized.slice(0, MAX_LIVE_STATE_CHARS)}…`
    : serialized;
  return [
    "CURRENT LIVE DJ STATE (client-captured; use it immediately and call dj_state only to refresh after a rejected action):",
    compact,
  ].join("\n");
}
