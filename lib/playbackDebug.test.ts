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
});
