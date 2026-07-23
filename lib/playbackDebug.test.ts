import { describe, expect, it } from "vitest";

import { formatPlaybackDebugPayload } from "./playbackDebug";

describe("formatPlaybackDebugPayload", () => {
  it("serializes console payloads without retaining live object graphs", () => {
    const payload: Record<string, unknown> = { status: "ready" };
    payload.self = payload;
    const formatted = formatPlaybackDebugPayload(payload, 80);

    expect(formatted).toContain('"status":"ready"');
    expect(formatted).toContain("[Circular]");
    expect(formatted.length).toBeLessThanOrEqual(80);
  });

  it("truncates to the exact requested length and ends with an ellipsis", () => {
    const formatted = formatPlaybackDebugPayload({ value: "abcdefghijk" }, 10);

    expect(formatted).toHaveLength(10);
    expect(formatted.endsWith("…")).toBe(true);
  });

  it("falls back safely when JSON cannot serialize the payload", () => {
    expect(formatPlaybackDebugPayload({ value: BigInt(1) })).toBe("[Unserializable payload]");
  });
});
