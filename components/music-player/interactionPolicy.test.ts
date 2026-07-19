import { describe, expect, it } from "vitest";

import { getPlayerEntryAction } from "./interactionPolicy";

describe("getPlayerEntryAction", () => {
  it("plays a loaded track before anonymous sign-in on the initial user gesture", () => {
    expect(
      getPlayerEntryAction({
        isAutoRequest: false,
        isAuthenticated: false,
        needsUserInteraction: true,
        hasTrack: true,
      }),
    ).toBe("togglePlayback");
  });

  it("signs in and continues when an anonymous listener requests a Revibe", () => {
    expect(
      getPlayerEntryAction({
        isAutoRequest: false,
        isAuthenticated: false,
        needsUserInteraction: false,
        hasTrack: true,
      }),
    ).toBe("signInAndContinue");
  });
});
