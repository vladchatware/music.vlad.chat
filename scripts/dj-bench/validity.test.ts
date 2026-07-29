import { describe, expect, it } from "vitest";

import { benchInvalidReason } from "./validity";

describe("DJ bench validity", () => {
  it("invalidates infrastructure and MCP tool failures", () => {
    expect(benchInvalidReason({
      terminalError: "Could not connect to MCP at http://localhost:3000/api/mcp.",
      mcpFailures: 0,
    })).toContain("Could not connect");
    expect(benchInvalidReason({
      terminalError: null,
      mcpFailures: 1,
    })).toBe("1 MCP tool failure(s)");
    expect(benchInvalidReason({
      terminalError: "Turn 1 deadline exceeded after 1000ms without accepted transition",
      mcpFailures: 0,
    })).toContain("deadline exceeded");
  });

  it("keeps a model holding loop as a valid performance result", () => {
    expect(benchInvalidReason({
      terminalError: "Turn 1 ended without accepted transition",
      mcpFailures: 0,
    })).toBeNull();
  });
});
