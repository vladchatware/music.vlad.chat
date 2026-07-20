import { describe, expect, it, vi } from "vitest";
import type { TrackAnalysis } from "../../lib/trackAnalysis";
import type { AnalysisJob } from "./api";
import { ANALYSIS_RESULT_MARKER, analyzeInFreshProcess } from "./analysisProcessClient";

const job = { sourceTrackId: "42" } as AnalysisJob;
const result = { sourceTrackId: "42" } as TrackAnalysis;
const stream = (value: string) => new Blob([value]).stream();
const payload = (value: unknown) => `${ANALYSIS_RESULT_MARKER}${JSON.stringify(value)}`;

describe("analysis process isolation", () => {
  it("returns a child process result", async () => {
    const spawn = vi.fn(() => ({
      exited: Promise.resolve(0),
      stdout: stream(payload({ ok: true, result })),
      stderr: stream(""),
      kill: vi.fn(),
    }));

    await expect(analyzeInFreshProcess(job, "token", spawn)).resolves.toEqual(result);
    expect(spawn).toHaveBeenCalledWith(job, "token");
  });

  it("keeps a completed result when native teardown crashes", async () => {
    const spawn = () => ({
      exited: Promise.resolve(133),
      stdout: stream(payload({ ok: true, result })),
      stderr: stream("pointer being freed was not allocated"),
      kill: vi.fn(),
    });

    await expect(analyzeInFreshProcess(job, "token", spawn)).resolves.toEqual(result);
  });

  it("reports a native child crash without killing the queue worker", async () => {
    const spawn = () => ({
      exited: Promise.resolve(133),
      stdout: stream(""),
      stderr: stream("pointer being freed was not allocated"),
      kill: vi.fn(),
    });

    await expect(analyzeInFreshProcess(job, "token", spawn)).rejects.toThrow(
      "Analysis process exited 133: pointer being freed was not allocated",
    );
  });

  it("ignores unrelated stdout before the framed result", async () => {
    const spawn = () => ({
      exited: Promise.resolve(0),
      stdout: stream(`diagnostic noise\n${payload({ ok: false, error: "rate limited" })}`),
      stderr: stream(""),
      kill: vi.fn(),
    });

    await expect(analyzeInFreshProcess(job, "token", spawn)).rejects.toThrow("rate limited");
  });

  it("kills an analysis process that exceeds its deadline", async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const spawn = () => ({
      exited: new Promise<number>(() => {}),
      stdout: stream(""),
      stderr: stream(""),
      kill,
    });

    const pending = analyzeInFreshProcess(job, "token", spawn, 1_000);
    const rejection = expect(pending).rejects.toThrow("Analysis process timed out after 1000ms");
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });
});
