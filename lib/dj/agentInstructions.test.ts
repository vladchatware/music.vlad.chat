import { describe, expect, it } from "vitest";

import { systemMessage } from "../ai";
import {
  DJ_SHARED_PERFORMANCE_INSTRUCTIONS,
  DJ_SHARED_POLICY_VERSION,
  getProductionDJModeInstruction,
} from "./agentInstructions";
import { BENCH_DJ_INSTRUCTIONS } from "../../scripts/dj-bench/prompt";

describe("DJ prompt parity", () => {
  it("uses exact shared musical policy in production and bench", () => {
    expect(systemMessage).toContain(DJ_SHARED_PERFORMANCE_INSTRUCTIONS);
    expect(BENCH_DJ_INSTRUCTIONS).toContain(DJ_SHARED_PERFORMANCE_INSTRUCTIONS);
    expect(systemMessage).toContain(DJ_SHARED_POLICY_VERSION);
    expect(BENCH_DJ_INSTRUCTIONS).toContain(DJ_SHARED_POLICY_VERSION);
  });

  it("carries researched opening context without claiming unsupported playback", () => {
    expect(systemMessage).toContain("PREPARED FRUTIGER AERO CRATE");
    expect(systemMessage).toContain("2090688897 | Frutiger Aero - Inuyasha");
    expect(systemMessage).toContain("call player immediately");
    expect(systemMessage).not.toContain("FIRST-WATER SCORE");
    expect(systemMessage.length).toBeLessThan(10_000);
  });

  it("gives each runtime mode one bounded job", () => {
    expect(getProductionDJModeInstruction("fresh_discovery")).toContain("at most two analysis calls");
    expect(getProductionDJModeInstruction("prepared_selection")).toContain("Call player now");
    expect(getProductionDJModeInstruction("post_player_preparation")).toContain("Do not call player");
    expect(getProductionDJModeInstruction("recovery")).toContain("retry player once");
  });
});
