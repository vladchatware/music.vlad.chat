import { describe, expect, it } from "vitest";

import {
  isLastingBodyTrack,
  minimumDwellExitSec,
  normalizeTrackDurationSec,
} from "../lastingSet";

describe("lasting set policy", () => {
  it("normalizes SoundCloud milliseconds and rejects short body tracks", () => {
    expect(normalizeTrackDurationSec(180_000)).toBe(180);
    expect(isLastingBodyTrack(120_000)).toBe(true);
    expect(isLastingBodyTrack(119_999)).toBe(false);
    expect(isLastingBodyTrack(undefined)).toBe(false);
  });

  it("moves an exit forward until the active track has been heard for 75 seconds", () => {
    expect(minimumDwellExitSec({ currentSourceSec: 30, audibleSec: 30 })).toBe(75);
    expect(minimumDwellExitSec({ currentSourceSec: 90, audibleSec: 80 })).toBe(90);
    expect(minimumDwellExitSec({ currentSourceSec: 30, audibleSec: 30, playbackRate: 1.1 }))
      .toBeCloseTo(79.5);
  });
});
