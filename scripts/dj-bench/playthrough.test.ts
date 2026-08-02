import { describe, expect, it } from "vitest";

import {
  runPreparedSelectionHoldingLoopRegression,
  runPreparedSelectionLatencyRegression,
  simulateBrowserPlaythrough,
} from "./playthrough";

describe("DJ bench browser playthrough", () => {
  it("rebuilds selection mode after serialized discovery and queues before deadline", () => {
    const result = simulateBrowserPlaythrough({
      trackDurationSec: 151.641,
      autoCueAtSec: 4,
      responseLatencyMs: 20_000,
      candidateIds: [101, 102],
    });

    expect(result).toMatchObject({
      status: "queued",
      responseCount: 2,
      modeSequence: ["fresh_discovery", "prepared_selection"],
      queuedTrackId: 101,
    });
    expect(result.queuedAtSec).toBeLessThan(result.deadlineAtSec);
    expect(result.events.map((event) => event.type)).toEqual([
      "auto_cue",
      "response_finished",
      "context_serialized",
      "response_finished",
      "track_queued",
    ]);
  });

  it("reports dj_failed_to_choose when reconstructed context keeps researching", () => {
    const result = simulateBrowserPlaythrough({
      trackDurationSec: 151.641,
      autoCueAtSec: 4,
      responseLatencyMs: 24_000,
      sessionMaxDurationMs: 70_000,
      candidateIds: [101, 102],
      reconstructMode: () => "fresh_discovery",
    });

    expect(result).toMatchObject({
      status: "dj_failed_to_choose",
      responseCount: 3,
      queuedTrackId: null,
    });
    expect(result.events.at(-1)).toMatchObject({ type: "deadline_exceeded" });
  });

  it("queues when observed prepared-selection continuation takes 52.379 seconds", () => {
    const result = simulateBrowserPlaythrough({
      trackDurationSec: 151.641,
      autoCueAtSec: 4.23,
      responseLatenciesMs: [52_379],
      candidateIds: [101, 102],
      preparedCandidateContext: true,
    });

    expect(result).toMatchObject({
      status: "queued",
      responseCount: 1,
      modeSequence: ["prepared_selection"],
    });
    expect(result.queuedAtSec).toBeLessThan(result.deadlineAtSec);
  });

  it("stores the cold-start failure witness before proving prepared context", () => {
    const proof = runPreparedSelectionLatencyRegression();

    expect(proof).toMatchObject({
      failureId: "prepared-selection-latency-deadline",
      failureWitness: {
        status: "dj_failed_to_choose",
        responseCount: 2,
      },
      current: {
        status: "queued",
        responseCount: 1,
      },
      passed: true,
    });
  });

  it("reproduces the regular-player incomplete prepared call before proving the compact contract", () => {
    expect(runPreparedSelectionHoldingLoopRegression()).toMatchObject({
      failureId: "prepared-selection-holding-loop",
      failureWitness: {
        status: "agent_holding_loop",
        responseCount: 1,
      },
      current: {
        status: "queued",
        responseCount: 1,
      },
      passed: true,
    });
  });
});
