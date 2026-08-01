import { describe, expect, it } from "vitest";

import {
  appendConfirmedTransition,
  appendScheduledCandidates,
  appendPlayedTrack,
  createPerformanceMemory,
} from "./performanceMemory";

const track = (id: number) => ({ id, title: `track-${id}`, artist: `artist-${id}` });

describe("performance memory compaction", () => {
  it("starts from a bounded researched candidate pool", () => {
    expect(createPerformanceMemory("stay live", [1, 2, 2, -1, 3]).candidateTrackIds)
      .toEqual([1, 2, 3]);
  });

  it("keeps the live-set intent while bounding played tracks and transitions", () => {
    let memory = createPerformanceMemory("keep a fluid frutiger aero set");

    for (let id = 1; id <= 14; id += 1) {
      memory = appendPlayedTrack(memory, track(id));
    }
    for (let id = 2; id <= 9; id += 1) {
      memory = appendConfirmedTransition(memory, {
        from: track(id - 1),
        to: track(id),
        energyArc: id % 2 === 0 ? "build" : "preserve",
        reason: `move-${id}`,
        outcome: "queued",
      });
    }

    expect(memory.intent).toBe("keep a fluid frutiger aero set");
    expect(memory.playedTracks.map(({ id }) => id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(memory.recentTransitions.map(({ to }) => to.id)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("records only confirmed outcomes and de-duplicates the current track", () => {
    const initial = appendPlayedTrack(createPerformanceMemory("stay live"), track(1));
    const repeated = appendPlayedTrack(initial, { ...track(1), title: "updated" });
    const failed = appendConfirmedTransition(repeated, {
      from: track(1),
      to: track(2),
      energyArc: "release",
      reason: "never happened",
      outcome: "failed",
    });

    expect(repeated.playedTracks).toEqual([{ id: 1, title: "updated", artist: "artist-1" }]);
    expect(failed.recentTransitions).toEqual([]);
  });

  it("retains a bounded fresh candidate pool across agent sessions", () => {
    let memory = createPerformanceMemory("stay live");
    memory = appendScheduledCandidates(memory, [1, 2, 3, 4, 5, 6, 7, 8]);
    memory = appendScheduledCandidates(memory, [8, 9, 10, 11, 12, 13, 14, 15]);
    memory = appendPlayedTrack(memory, track(10));

    expect(memory.candidateTrackIds).toEqual([4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15]);
  });
});
