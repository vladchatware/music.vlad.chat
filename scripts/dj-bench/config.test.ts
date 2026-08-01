import { describe, expect, it } from "vitest";

import { parseBenchConfig } from "./config";

describe("parseBenchConfig", () => {
  it("uses safe headless defaults", () => {
    const config = parseBenchConfig([], {});
    expect(config).toMatchObject({
      provider: "gateway",
      targetDurationSec: 90 * 60,
      transitions: 64,
      maxSteps: 8,
      clockSpeed: 1,
      planningLeadSec: 90,
      mcpUrl: "http://localhost:3000/api/mcp",
      scenario: "revibe",
    });
    expect(config.failures.size).toBe(0);
    expect(config.tracePath).toMatch(/logs\/dj-bench\/.+\/trace\.jsonl$/);
    expect(config.reportPath).toMatch(/logs\/dj-bench\/.+\/report\.md$/);
    expect(config.manifestPath).toMatch(/logs\/dj-bench\/.+\/manifest\.json$/);
  });

  it("parses model, episode, clock, failures, and scenario", () => {
    const config = parseBenchConfig([
      "--model", "openai/gpt-5-mini",
      "--duration-min", "120",
      "--transitions=7",
      "--clock-speed", "4",
      "--planning-lead-sec", "120",
      "--fail", "stale-state,missing-analysis",
      "--scenario", "interventions",
      "--outgoing-id", "2094321906",
      "--quiet",
    ], {});
    expect(config.model).toBe("openai/gpt-5-mini");
    expect(config.transitions).toBe(7);
    expect(config.targetDurationSec).toBe(120 * 60);
    expect(config.clockSpeed).toBe(4);
    expect(config.planningLeadSec).toBe(120);
    expect([...config.failures]).toEqual(["stale-state", "missing-analysis"]);
    expect(config.scenario).toBe("interventions");
    expect(config.outgoingTrackId).toBe(2094321906);
    expect(config.quiet).toBe(true);
  });

  it("has no independent turn cutoff unless explicitly requested", () => {
    expect(parseBenchConfig([], {}).timeoutMs).toBeUndefined();
    expect(parseBenchConfig(["--timeout-ms", "70000"], {}).timeoutMs).toBe(70_000);
  });

  it("rejects unknown failures and invalid counts", () => {
    expect(() => parseBenchConfig(["--fail", "rain"], {})).toThrow(/Unknown failure/);
    expect(() => parseBenchConfig(["--transitions", "0"], {})).toThrow(/positive integer/);
  });

  it("configures OpenCode Zen without exposing key as an argument", () => {
    const config = parseBenchConfig(
      ["--provider", "opencode", "--model", "gpt-5.6-sol"],
      { OPENCODE_API_KEY: "secret" },
    );
    expect(config.provider).toBe("opencode");
    expect(config.model).toBe("gpt-5.6-sol");
    expect(config.opencodeBaseUrl).toBe("https://opencode.ai/zen/v1");
  });

  it("uses OpenCode DeepSeek by default when its key exists", () => {
    const config = parseBenchConfig([], { OPENCODE_API_KEY: "secret" });
    expect(config.provider).toBe("opencode");
    expect(config.model).toBe("deepseek-v4-flash");
  });

  it("requires OpenCode key", () => {
    expect(() => parseBenchConfig(["--provider", "opencode"], {}))
      .toThrow(/OPENCODE_API_KEY/);
  });

  it("places companion artifacts beside explicit trace", () => {
    const config = parseBenchConfig(["--trace", "/tmp/my-run.jsonl"], {});
    expect(config).toMatchObject({
      runId: "my-run",
      tracePath: "/tmp/my-run.jsonl",
      summaryPath: "/tmp/my-run.summary.json",
      reportPath: "/tmp/my-run.report.md",
      configPath: "/tmp/my-run.config.json",
      manifestPath: "/tmp/my-run.manifest.json",
    });
  });
});
