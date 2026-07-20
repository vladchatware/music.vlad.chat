import { describe, expect, it } from "vitest";

import { buildRevibePrompt, REVIBE_PROMPT } from "./prompt";

describe("buildRevibePrompt", () => {
  it("uses a natural continuation request without injecting metadata", () => {
    const prompt = buildRevibePrompt({
      track: { id: 1, title: "Current", bpm: 128 },
      detectedBpm: 128,
      continuityMode: true,
    });

    expect(prompt).toBe(REVIBE_PROMPT);
    expect(prompt).not.toContain("128");
    expect(prompt).not.toContain("Current");
  });

  it("uses same natural direction for manual revibe", () => {
    expect(
      buildRevibePrompt({ track: null, detectedBpm: null, continuityMode: false }),
    ).toBe(REVIBE_PROMPT);
  });
});
