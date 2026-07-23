import { describe, expect, it } from "vitest";

import { DEFAULT_DJ_MODEL, resolveDJModel } from "./djModel";

describe("resolveDJModel", () => {
  it("uses DeepSeek V4 Flash through AI Gateway by default", () => {
    expect(DEFAULT_DJ_MODEL).toBe("deepseek/deepseek-v4-flash");
    expect(resolveDJModel(undefined)).toBe(DEFAULT_DJ_MODEL);
    expect(resolveDJModel("   ")).toBe(DEFAULT_DJ_MODEL);
  });

  it("uses an explicit DJ_MODEL override", () => {
    expect(resolveDJModel("anthropic/claude-sonnet-4.5")).toBe(
      "anthropic/claude-sonnet-4.5",
    );
  });
});
