import { describe, expect, it } from "vitest";

import { benchInvalidReason, hasValidCandidatePreparation } from "./validity";

describe("DJ bench preparation validity", () => {
  it("accepts a validated prepared opening without redundant cold-start discovery", () => {
    expect(hasValidCandidatePreparation({
      preparedOpening: true,
      likesCalls: 0,
      tracksCalls: 0,
    })).toBe(true);
  });

  it("requires both live discovery sources when no prepared opening exists", () => {
    expect(hasValidCandidatePreparation({
      preparedOpening: false,
      likesCalls: 1,
      tracksCalls: 1,
    })).toBe(true);
    expect(hasValidCandidatePreparation({
      preparedOpening: false,
      likesCalls: 0,
      tracksCalls: 1,
    })).toBe(false);
    expect(hasValidCandidatePreparation({
      preparedOpening: false,
      likesCalls: 1,
      tracksCalls: 0,
    })).toBe(false);
  });

  it("separates bootstrap infrastructure failures from model performance", () => {
    expect(benchInvalidReason({
      terminalError: "Could not connect to MCP",
      runtimeStarted: false,
      outgoingTrackLoaded: false,
    })).toContain("Could not connect to MCP");
    expect(benchInvalidReason({
      terminalError: "Turn ended without accepted transition",
      runtimeStarted: true,
      outgoingTrackLoaded: true,
    })).toBeNull();
  });
});
