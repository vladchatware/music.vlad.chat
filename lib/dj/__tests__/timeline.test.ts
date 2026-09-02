import { describe, expect, it } from "vitest";

import {
  createDJTimelineController,
  djTimelinePatchSchema,
  type DJTimelinePatch,
  type PlayerToolInput,
} from "..";

function request(id: number): PlayerToolInput {
  return {
    id,
    performance: {
      energyArc: "preserve",
      exit: { anchor: "mix_out" },
      entry: { anchor: "mix_in" },
      blend: {
        duration: { bars: 8 },
        crossfaderCurve: "equal_power",
        eq: "bass_swap",
      },
      tempo: { mode: "preserve" },
      reason: `Carry timeline into ${id}`,
    },
  };
}

function patch(baseRevision: number, ids: number[]): DJTimelinePatch {
  return { baseRevision, tracks: ids.map(request) };
}

describe("djTimelinePatchSchema", () => {
  it("accepts one to three unique future tracks", () => {
    expect(djTimelinePatchSchema.safeParse(patch(0, [1])).success).toBe(true);
    expect(djTimelinePatchSchema.safeParse(patch(0, [1, 2, 3])).success).toBe(true);
    expect(djTimelinePatchSchema.safeParse(patch(0, [1, 2, 3, 4])).success).toBe(false);
    expect(djTimelinePatchSchema.safeParse(patch(0, [1, 1])).success).toBe(false);
  });

  it("repairs tempo emitted beside performance in a multi-track call", () => {
    const misplaced = patch(0, [1, 2]);
    const tracks = misplaced.tracks.map(({ performance, ...track }) => {
      const { tempo, ...rest } = performance;
      return { ...track, performance: rest, tempo };
    });

    const parsed = djTimelinePatchSchema.safeParse({ ...misplaced, tracks });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tracks[0]?.performance.tempo).toEqual({ mode: "preserve" });
      expect(parsed.data.tracks[0]).not.toHaveProperty("tempo");
    }
  });

  it("normalizes a smooth crossfader request to the equal-power curve", () => {
    const input = patch(0, [1]);
    input.tracks[0]!.performance.blend.crossfaderCurve = "smooth" as "equal_power";

    const parsed = djTimelinePatchSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tracks[0]?.performance.blend.crossfaderCurve).toBe("equal_power");
    }
  });
});

describe("createDJTimelineController", () => {
  it("commits head while keeping suffix editable", () => {
    let event = 0;
    const timeline = createDJTimelineController({
      generateId: () => `event-${++event}`,
    });

    expect(timeline.replaceSuffix(patch(0, [10, 20, 30])).outcome).toBe("accepted");
    const committed = timeline.commitNext();

    expect(committed).toMatchObject({
      eventId: "event-1",
      status: "committed",
      request: { id: 10 },
    });
    expect(timeline.snapshot()).toMatchObject({
      revision: 1,
      playbackRevision: 1,
      plannedTrackIds: [10, 20, 30],
      editableAfterEventId: "event-1",
      planned: [{ request: { id: 20 } }, { request: { id: 30 } }],
    });
  });

  it("replaces only uncommitted suffix", () => {
    let event = 0;
    const timeline = createDJTimelineController({
      generateId: () => `event-${++event}`,
    });
    timeline.replaceSuffix(patch(0, [10, 20, 30]));
    timeline.commitNext();

    const result = timeline.replaceSuffix(patch(1, [40, 50]));

    expect(result.outcome).toBe("accepted");
    expect(timeline.snapshot().plannedTrackIds).toEqual([10, 40, 50]);
    expect(timeline.snapshot().committed?.request.id).toBe(10);
  });

  it("rejects stale reconstruction and committed-track duplication", () => {
    const timeline = createDJTimelineController({ generateId: () => "event" });
    timeline.replaceSuffix(patch(0, [10, 20]));
    timeline.commitNext();

    expect(timeline.replaceSuffix(patch(0, [30]))).toMatchObject({
      outcome: "rejected",
      reason: "stale_revision",
    });
    expect(timeline.replaceSuffix(patch(1, [30, 10]))).toMatchObject({
      outcome: "rejected",
      reason: "duplicate_track",
    });
  });

  it("advances after playback and records mechanical failure", () => {
    const timeline = createDJTimelineController({
      generateId: () => "event",
      now: () => 123,
    });
    timeline.replaceSuffix(patch(0, [10, 20]));
    timeline.commitNext();
    timeline.completeCommitted(10);
    expect(timeline.snapshot().plannedTrackIds).toEqual([20]);

    timeline.commitNext();
    timeline.failCommitted(20, "stream unavailable");
    expect(timeline.snapshot()).toMatchObject({
      plannedTrackIds: [],
      lastFailure: { trackId: 20, reason: "stream unavailable", atMs: 123 },
    });
  });

  it("accepts suffix work authored while player advances", () => {
    let event = 0;
    const timeline = createDJTimelineController({
      generateId: () => `event-${++event}`,
    });
    timeline.replaceSuffix(patch(0, [10, 20, 30]));
    const agentBaseRevision = timeline.snapshot().revision;

    timeline.commitNext();
    timeline.completeCommitted(10);
    timeline.commitNext();

    const result = timeline.replaceSuffix(patch(agentBaseRevision, [20, 40, 50]));
    expect(result.outcome).toBe("accepted");
    expect(timeline.snapshot()).toMatchObject({
      committed: { request: { id: 20 } },
      plannedTrackIds: [20, 40, 50],
    });
  });
});
