import { describe, expect, it } from "vitest";

import { benchInvalidReason, hasValidCandidatePreparation } from "./validity";

describe("DJ bench preparation validity", () => {
  it("requires both live discovery sources", () => {
    expect(hasValidCandidatePreparation({
      likesCalls: 1,
      tracksCalls: 1,
    })).toBe(true);
    expect(hasValidCandidatePreparation({
      likesCalls: 0,
      tracksCalls: 1,
    })).toBe(false);
    expect(hasValidCandidatePreparation({
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
