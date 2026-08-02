import { describe, expect, it } from "vitest";

import { analyzeAudibleCoverage, audibleSegmentsAt, segmentSourceTime, type BenchAudibleSegment } from "./timeline";

const segment: BenchAudibleSegment = {
  id: "track-1-0",
  trackId: 1,
  title: "Fixture",
  setStartSec: 100,
  setEndSec: 200,
  sourceStartSec: 20,
  sourceEndSec: 120,
  playbackRate: 1,
};

describe("bench timeline", () => {
  it("maps global set time to source track time", () => {
    expect(segmentSourceTime(segment, 115)).toBe(35);
    expect(segmentSourceTime(segment, 500)).toBe(120);
  });

  it("finds overlapping audible decks during a blend", () => {
    const incoming = { ...segment, id: "track-2-1", trackId: 2, setStartSec: 190, setEndSec: 300 };
    expect(audibleSegmentsAt([segment, incoming], 195).map(({ trackId }) => trackId))
      .toEqual([1, 2]);
  });

  it("does not hide an earlier gap behind a later segment", () => {
    const later = { ...segment, id: "track-2-1", trackId: 2, setStartSec: 210, setEndSec: 300 };
    expect(analyzeAudibleCoverage([
      { ...segment, setStartSec: 0, setEndSec: 100, sourceStartSec: 0, sourceEndSec: 100 },
      later,
    ], 300)).toEqual({
      continuousThroughSec: 100,
      coveredDurationSec: 190,
      maxGapSec: 110,
    });
  });
});
