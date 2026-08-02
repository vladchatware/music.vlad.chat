import { describe, expect, it } from "vitest";

import {
  advanceAudibleDwell,
  isLastingBodyTrack,
  minimumDwellExitSec,
  normalizeTrackDurationSec,
} from "../lastingSet";

describe("lasting set policy", () => {
  it("normalizes SoundCloud milliseconds and rejects short body tracks", () => {
    expect(normalizeTrackDurationSec(180_000, "ms")).toBe(180);
    expect(normalizeTrackDurationSec(180, "sec")).toBe(180);
    expect(isLastingBodyTrack(120_000, "ms")).toBe(true);
    expect(isLastingBodyTrack(119_999, "ms")).toBe(false);
    expect(isLastingBodyTrack(9_000, "ms")).toBe(false);
    expect(isLastingBodyTrack(601, "sec")).toBe(false);
    expect(isLastingBodyTrack(undefined, "sec")).toBe(false);
  });

  it("counts source progress only while playback is audible", () => {
    let state = advanceAudibleDwell(null, {
      trackId: 7,
      sourceSec: 10,
      playbackRate: 1.25,
      playing: true,
    });
    state = advanceAudibleDwell(state, {
      trackId: 7,
      sourceSec: 35,
      playbackRate: 1.25,
      playing: true,
    });
    expect(state.audibleSec).toBe(20);
    state = advanceAudibleDwell(state, {
      trackId: 7,
      sourceSec: 35,
      playbackRate: 1.25,
      playing: false,
    });
    expect(state.audibleSec).toBe(20);
  });

  it("moves an exit forward until the active track has been heard for 75 seconds", () => {
    expect(minimumDwellExitSec({ currentSourceSec: 30, audibleSec: 30 })).toBe(75);
    expect(minimumDwellExitSec({ currentSourceSec: 90, audibleSec: 80 })).toBe(90);
    expect(minimumDwellExitSec({ currentSourceSec: 30, audibleSec: 30, playbackRate: 1.1 }))
      .toBeCloseTo(79.5);
  });
});
