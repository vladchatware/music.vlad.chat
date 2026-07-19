import { describe, expect, it } from "vitest";

import { composeRtmpsUrl, redactRtmpsUrl } from "./rtmps";

describe("RTMPS destination", () => {
  it("joins Instagram server and stream key without altering opaque key", () => {
    expect(composeRtmpsUrl("rtmps://upload.instagram.com:443/rtmp/", "abc?def=1"))
      .toBe("rtmps://upload.instagram.com:443/rtmp/abc?def=1");
  });

  it("rejects unsafe destinations", () => {
    expect(() => composeRtmpsUrl("https://example.com", "key")).toThrow("RTMPS");
    expect(() => composeRtmpsUrl("rtmps://user:pass@example.com/live", "key"))
      .toThrow("Credentials");
  });

  it("never returns stream path while redacting", () => {
    expect(redactRtmpsUrl("rtmps://example.com/live/secret"))
      .toBe("rtmps://example.com/…");
  });
});
