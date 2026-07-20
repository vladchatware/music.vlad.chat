import { describe, expect, it } from "vitest";

import { projectTransitionClock } from "../performance/previewClock";

describe("projectTransitionClock", () => {
  it("keeps both deck playheads on one normalized transition clock", () => {
    expect(projectTransitionClock({
      outgoingStartSec: 48,
      incomingStartSec: 12,
      incomingPlaybackRate: 0.96,
      durationSec: 8,
      elapsedSec: 4,
    })).toEqual({
      progress: 0.5,
      outgoingSec: 52,
      incomingSec: 15.84,
    });
  });

  it("clamps both playheads to the transition bounds", () => {
    expect(projectTransitionClock({
      outgoingStartSec: 48,
      incomingStartSec: 12,
      incomingPlaybackRate: 1.04,
      durationSec: 8,
      elapsedSec: 20,
    })).toEqual({
      progress: 1,
      outgoingSec: 56,
      incomingSec: 20.32,
    });
  });
});
