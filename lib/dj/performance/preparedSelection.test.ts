import { describe, expect, it } from "vitest";

import {
  hydratePreparedPlayerSelection,
  resolvePreparedPlayerSelection,
} from "./preparedSelection";

describe("prepared player selection", () => {
  it("hydrates a compact musical choice into a safe complete player plan", () => {
    expect(hydratePreparedPlayerSelection({
      id: 719940358,
      energyArc: "preserve",
      reason: "Keep the bright wistful lift without forcing a tempo jump.",
    })).toMatchObject({
      id: 719940358,
      performance: {
        energyArc: "preserve",
        exit: { anchor: "next_phrase" },
        entry: { anchor: "mix_in" },
        blend: { duration: { bars: 8 }, eq: "bass_swap" },
        tempo: { mode: "preserve" },
      },
    });
  });

  it("only hydrates IDs from the live prepared pool", () => {
    const selection = {
      id: 719940358,
      energyArc: "preserve" as const,
      reason: "Keep the bright wistful lift.",
    };
    expect(resolvePreparedPlayerSelection(selection, [719940358])).not.toBeNull();
    expect(resolvePreparedPlayerSelection(selection, [151178937])).toBeNull();
  });
});
