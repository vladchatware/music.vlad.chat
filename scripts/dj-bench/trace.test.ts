import { describe, expect, it } from "vitest";

import { formatTraceEvent } from "./trace";

describe("trace terminal formatting", () => {
  it("shows full multiline agent text", () => {
    expect(formatTraceEvent({
      sequence: 1,
      wallTime: "2026-07-28T00:00:00.000Z",
      wallElapsedMs: 100,
      simulatedTimeSec: 67.1,
      type: "agent.step",
      text: "Checking decks.\nThen searching likes.",
    })).toBe(
      "[01:07.1] agent.step\n  model> Checking decks.\n  model> Then searching likes.",
    );
  });
});
