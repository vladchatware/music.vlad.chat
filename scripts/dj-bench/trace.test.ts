import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { formatTraceEvent, TraceRecorder } from "./trace";

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

  it("rebuilds manifest events from the trace file", () => {
    const directory = mkdtempSync(join(tmpdir(), "dj-bench-trace-"));
    const trace = new TraceRecorder(join(directory, "trace.jsonl"), true);
    trace.record("tool.finished", 12.5, { output: { status: "ready" } });

    expect(trace.events).toEqual([
      expect.objectContaining({
        sequence: 1,
        simulatedTimeSec: 12.5,
        type: "tool.finished",
        output: { status: "ready" },
      }),
    ]);
  });
});
