import { describe, expect, it } from "vitest";
import {
  getAnalysisRetryPolicy,
  sanitizeAnalysisError,
} from "../analysisQueuePolicy";

describe("analysis queue policy", () => {
  it("backs off failed jobs and dead-letters third attempt", () => {
    expect(getAnalysisRetryPolicy(1, 1_000)).toEqual({
      dead: false,
      nextAttemptAt: 31_000,
    });
    expect(getAnalysisRetryPolicy(2, 1_000)).toEqual({
      dead: false,
      nextAttemptAt: 61_000,
    });
    expect(getAnalysisRetryPolicy(3, 1_000)).toEqual({
      dead: true,
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
    });
  });

  it("flattens and bounds worker errors", () => {
    const result = sanitizeAnalysisError(
      `token\nhttps://cdn.example/audio?access_token=secret\t${"x".repeat(600)}`,
    );
    expect(result).not.toMatch(/[\n\t]/);
    expect(result).not.toContain("cdn.example");
    expect(result).not.toContain("secret");
    expect(result).toHaveLength(500);
  });
});
