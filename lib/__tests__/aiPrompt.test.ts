import { describe, expect, it } from "vitest";

import { systemMessage } from "../ai";

describe("DJ system prompt", () => {
  it("makes the agent research state and metadata before one performance call", () => {
    expect(systemMessage).toContain("dj_state");
    expect(systemMessage).toContain("playedTrackIds array into exclude_ids");
    expect(systemMessage).toContain("track_analysis");
    expect(systemMessage).toContain("exactly one player");
    expect(systemMessage).toContain("declarative performance plan");
    expect(systemMessage).toContain("outgoing exit segment");
    expect(systemMessage).toContain("incoming entry segments");
    expect(systemMessage).toContain("planner validates exact timing");
    expect(systemMessage).toContain("vocal overlap");
    expect(systemMessage).toContain("local mood");
    expect(systemMessage).toContain("native valence/arousal");
    expect(systemMessage).toContain("MIREX-cluster change");
    expect(systemMessage).toContain("Genre, instruments, and bright/dark timbre");
    expect(systemMessage).toContain("never as hard compatibility gates");
    expect(systemMessage).toContain("MTG-Jamendo mood/theme");
    expect(systemMessage).toContain("high-energy exit into a low-energy entry is not build or preserve");
    expect(systemMessage).toContain("reject that candidate");
    expect(systemMessage).toContain("falling segment or breakdown");
    expect(systemMessage).toContain("Never pair release with next_phrase");
    expect(systemMessage).toContain("only when that exact section appears in track_analysis");
  });

  it("does not collapse mixed liked-and-similar requests into likes only", () => {
    expect(systemMessage).toContain('"from my likes or similar tracks" means sample both sources');
    expect(systemMessage).toContain("call likes for taste seeds and tracks at least once");
    expect(systemMessage).toContain('Do not interpret "or" as permission to stop after likes');
    expect(systemMessage).toContain("Finding a playable liked track does not satisfy the exploration branch");
  });

  it("queues promising uncached exploration candidates without blocking playback", () => {
    expect(systemMessage).toContain("immediately after tracks search call schedule_track_analysis");
    expect(systemMessage).toContain("whether or not another liked candidate already has prepared analysis");
    expect(systemMessage).toContain("queue deduplicates cached candidates");
    expect(systemMessage).toContain("never wait or poll");
    expect(systemMessage).toContain("missing analysis must not prevent the player call");
  });

  it("refreshes candidates instead of cycling stale played IDs", () => {
    expect(systemMessage).toContain("refresh candidates with likes or tracks using exclude_ids");
    expect(systemMessage).toContain("Never pick another stale candidate");
  });

  it("includes a concrete fragment-score example", () => {
    expect(systemMessage.indexOf("FIRST ENTRANCE OVERRIDE")).toBeLessThan(
      systemMessage.indexOf("PERFORMANCE LOOP"),
    );
    expect(systemMessage).toContain(
      "submit the PREPARED FIRST-WATER PERFORMANCE",
    );
    expect(systemMessage).toContain(
      "This overrides discovery and single-transition planning",
    );
    expect(systemMessage).toContain("PREPARED FIRST-WATER PERFORMANCE");
    expect(systemMessage).toContain("F001 water/origin");
    expect(systemMessage).toContain("151178937");
    expect(systemMessage).toContain("cue s0 0.000–5.119 s");
    expect(systemMessage).toContain("F029 water/stride");
    expect(systemMessage).toContain("BOUNDARY CONTRACT");
    expect(systemMessage).not.toContain("F030");
    expect(systemMessage).not.toContain("F454");
    expect(systemMessage).not.toContain("SOURCE_1");
  });

  it("frames multi-track composition as one bounded atomic score", () => {
    expect(systemMessage).toContain("hundreds of short fragments");
    expect(systemMessage).toContain("Source count is not the horizon");
    expect(systemMessage).toContain("Use one agent session");
    expect(systemMessage).toContain("never create concurrent sessions");
    expect(systemMessage).toContain("Motifs organize sources");
    expect(systemMessage).toContain("Metric compatibility without an audible through-line");
    expect(systemMessage).toContain("Density must have grammar");
    expect(systemMessage).toContain("Do not commit the first merely valid sequence");
    expect(systemMessage).toContain("failure outcome agent_holding_loop");
    expect(systemMessage).toContain("at least 64 seconds of safe musical runway");
  });
});
