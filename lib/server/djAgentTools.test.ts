import { describe, expect, it, vi } from "vitest";

import {
  createBoundedAnalysisSchedule,
  createBatchAnalysisReader,
  createDJAgentTools,
  limitForegroundAnalysis,
} from "./djAgentTools";

describe("limitForegroundAnalysis", () => {
  it("bounds foreground analysis while allowing the background queue to stay broad", async () => {
    const read = vi.fn(async (id: number, aspect: string) => ({ status: "ready", id, aspect }));
    const limited = limitForegroundAnalysis(read, 3);

    const results = await Promise.all([
      limited(1, "summary"),
      limited(2, "summary"),
      limited(3, "energy"),
      limited(4, "full"),
    ]);

    expect(read).toHaveBeenCalledTimes(3);
    expect(results[3]).toEqual({
      status: "foreground_budget_exhausted",
      trackId: "4",
      instruction: "Choose from the analyses already returned and call player now.",
    });
  });
});

describe("createBatchAnalysisReader", () => {
  it("returns aligned evidence without ranking or selecting a winner", async () => {
    const read = vi.fn(async (id: number, aspect: string) => ({ status: "ready", id, aspect }));
    const compare = createBatchAnalysisReader(read);

    const result = await compare([3, 2, 3], "energy");

    expect(result).toEqual({
      evidence: [
        { id: 3, result: { status: "ready", id: 3, aspect: "energy" } },
        { id: 2, result: { status: "ready", id: 2, aspect: "energy" } },
      ],
    });
    expect(result).not.toHaveProperty("winner");
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("createBoundedAnalysisSchedule", () => {
  it("accepts only one background queue call per agent turn", async () => {
    const schedule = vi.fn(async (ids: number[]) => ({
      enqueued: ids.length,
      cached: 0,
      existing: 0,
    }));
    const scheduleOnce = createBoundedAnalysisSchedule(schedule);

    const [first, duplicate] = await Promise.all([
      scheduleOnce([1, 2, 2]),
      scheduleOnce([1, 2]),
    ]);

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith([1, 2], 10);
    expect(first).toMatchObject({ status: "scheduled", trackIds: [1, 2] });
    expect(duplicate).toEqual({
      status: "already_scheduled",
      trackIds: [1, 2],
    });
  });
});

describe("createDJAgentTools player provenance", () => {
  it("accepts only IDs returned by discovery when a candidate set is present", () => {
    const tools = createDJAgentTools(undefined, {
      playerCandidateIds: [101, 102],
    });
    const performance = {
      energyArc: "preserve" as const,
      exit: { anchor: "next_phrase" as const },
      entry: { anchor: "mix_in" as const },
      blend: {
        duration: { bars: 4 as const },
        crossfaderCurve: "equal_power" as const,
        eq: "smooth" as const,
      },
      tempo: { mode: "preserve" as const },
      reason: "Use a discovered candidate",
    };

    expect(tools.player.inputSchema.safeParse({
      baseRevision: 0,
      tracks: [{ id: 101, performance }],
    }).success).toBe(true);
    expect(tools.player.inputSchema.safeParse({
      baseRevision: 0,
      tracks: [{ id: 1, performance }],
    }).success).toBe(false);
    expect(tools.player.inputSchema.safeParse({
      baseRevision: 0,
      tracks: [{ id: 101, performance: {
        ...performance,
        reason: "Testing candidate 101 viability",
      } }],
    }).success).toBe(false);
  });

  it("uses the compact decision contract for an already prepared pool", () => {
    const tools = createDJAgentTools(undefined, {
      playerCandidateIds: [101, 102],
      compactPlayerSelection: true,
    });

    expect(tools.player.inputSchema.safeParse({
      baseRevision: 4,
      tracks: [{
        id: 101,
        energyArc: "preserve",
        reason: "Carry the bright water texture forward.",
      }, {
        id: 102,
        energyArc: "build",
        reason: "Turn shimmer into forward motion.",
      }],
    }).success).toBe(true);
    expect(tools.player.inputSchema.safeParse({
      baseRevision: 4,
      tracks: [{
        id: 101,
        performance: { energyArc: "preserve" },
      }],
    }).success).toBe(false);
    expect(tools.player.inputSchema.safeParse({
      baseRevision: 4,
      tracks: [{
        id: 999,
        energyArc: "preserve",
        reason: "Unknown candidate.",
      }],
    }).success).toBe(false);
  });
});
