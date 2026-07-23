import { describe, expect, it } from "vitest";

import {
  EXPERT_PERFORMANCE_SCORE_EXAMPLE,
  FIRST_WATER_FRAGMENT_COUNT,
  FIRST_WATER_SCORE,
} from "./expertScoreExample";
import {
  PREPARED_FIRST_DRIVE_FRAGMENT_COUNT,
  PREPARED_FIRST_DRIVE_SCORE,
} from "./preparedFirstDriveScore.generated";

describe("first-water performance prompt", () => {
  it("carries only the concrete first-water minute", () => {
    expect(EXPERT_PERFORMANCE_SCORE_EXAMPLE).toContain(
      "PREPARED FIRST-WATER PERFORMANCE",
    );
    expect(EXPERT_PERFORMANCE_SCORE_EXAMPLE).toContain(
      "Score bounds: 00:00.000–01:00.000.",
    );
    expect(FIRST_WATER_FRAGMENT_COUNT).toBe(29);
    expect(FIRST_WATER_SCORE.split("\n")).toHaveLength(29);
    expect(FIRST_WATER_SCORE).toContain("F001 water/origin");
    expect(FIRST_WATER_SCORE).toContain("F029 water/stride");
    expect(FIRST_WATER_SCORE).not.toContain("F030");
    expect(EXPERT_PERFORMANCE_SCORE_EXAMPLE).not.toContain("F454");
  });

  it("keeps concrete bounds, source, cue, evidence, and edit in every row", () => {
    for (const row of FIRST_WATER_SCORE.split("\n")) {
      expect(row).toMatch(/^F\d{3} [^|]+ \| @\d{2}:\d{2}\.\d{3}>\d{2}:\d{2}\.\d{3}/);
      expect(row).toMatch(/\| src \d+ —/);
      expect(row).toMatch(/\| cue s\d+ /);
      expect(row).toMatch(/\| e\d/);
      expect(row).toContain("| edit ");
    }
  });

  it("closes the preview at exactly one minute", () => {
    expect(EXPERT_PERFORMANCE_SCORE_EXAMPLE).toContain(
      "Crop F029 at 01:00.000",
    );
    expect(FIRST_WATER_SCORE).toContain("@00:59.326>01:00.000");
    expect(FIRST_WATER_SCORE).toContain("boundary crop source");
  });

  it("retains full score outside prompt without injecting it", () => {
    expect(PREPARED_FIRST_DRIVE_FRAGMENT_COUNT).toBeGreaterThan(400);
    expect(PREPARED_FIRST_DRIVE_SCORE.split("\n")).toHaveLength(
      PREPARED_FIRST_DRIVE_FRAGMENT_COUNT,
    );
    expect(EXPERT_PERFORMANCE_SCORE_EXAMPLE.length).toBeLessThan(30_000);
  });
});
