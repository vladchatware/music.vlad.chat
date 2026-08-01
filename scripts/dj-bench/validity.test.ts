import { describe, expect, it } from "vitest";

import { hasValidCandidatePreparation } from "./validity";

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
  });
});
