import { describe, expect, it } from "vitest";

import { getPlayerEntryAction } from "./interactionPolicy";

describe("getPlayerEntryAction", () => {
  it("starts a loaded track and anonymous sign-in from the initial user gesture", () => {
    expect(
      getPlayerEntryAction({
        isAutoRequest: false,
        isAuthenticated: false,
        needsUserInteraction: true,
        hasTrack: true,
      }),
    ).toBe("togglePlaybackAndSignIn");
  });

  it("loads a missing track and signs in from the initial user gesture", () => {
    expect(
      getPlayerEntryAction({
        isAutoRequest: false,
        isAuthenticated: false,
        needsUserInteraction: true,
        hasTrack: false,
      }),
    ).toBe("loadPlayAndSignIn");
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

  it("signs in and continues when auto-Revibe fires for an anonymous listener", () => {
    expect(
      getPlayerEntryAction({
        isAutoRequest: true,
        isAuthenticated: false,
        needsUserInteraction: false,
        hasTrack: true,
      }),
    ).toBe("signInAndContinue");
  });
});
