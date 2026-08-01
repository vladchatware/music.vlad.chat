import { describe, expect, it } from "vitest";

import {
  FRUTIGER_AERO_OPENING_TRACK_IDS,
  FRUTIGER_AERO_OPENING_TRACKS,
  FRUTIGER_AERO_PREPARED_OPENER_ANALYSIS,
  FRUTIGER_AERO_PREPARED_CONTEXT,
} from "./frutigerAeroPreparedSet";

describe("prepared Frutiger Aero opening", () => {
  it("contains only lasting analyzed bodies and excludes the short metadata impostor", () => {
    expect(FRUTIGER_AERO_OPENING_TRACKS.every(({ duration }) => duration >= 120_000))
      .toBe(true);
    expect(FRUTIGER_AERO_OPENING_TRACK_IDS).not.toContain(1473239071);
    expect(FRUTIGER_AERO_PREPARED_CONTEXT).not.toContain("1473239071");
  });

  it("offers a tempo-compatible prepared choice around a 140 BPM outgoing deck", () => {
    expect(FRUTIGER_AERO_OPENING_TRACKS).toContainEqual(
      expect.objectContaining({ id: 2220048569, bpm: 140.99 }),
    );
  });

  it("carries inspected opener evidence for a cold analysis cache", () => {
    expect(FRUTIGER_AERO_PREPARED_OPENER_ANALYSIS).toMatchObject({
      trackId: "151178937",
      durationSec: 296.228,
      tempo: { bpm: 93.77 },
      tonal: { camelotKey: "5B" },
    });
  });
});
