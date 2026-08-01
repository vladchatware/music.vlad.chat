import { beforeEach, describe, expect, it, vi } from "vitest";

const soundcloud = vi.hoisted(() => ({
  track: vi.fn(),
  resolveTrackStreamUrl: vi.fn(),
}));
const decoder = vi.hoisted(() => ({ decodeUrlToMonoPcm: vi.fn() }));

vi.mock("../../soundcloud", () => soundcloud);
vi.mock("./decode", () => decoder);

import { processAnalysisJob } from "./processJob";
import { ANALYSIS_SAMPLE_RATE } from "./config";
import { TRACK_ANALYSIS_VERSION } from "../../lib/trackAnalysis";

const job = {
  cacheKey: "soundcloud:12:essentia-dj-v1",
  sourceTrackId: "12",
  analysisVersion: "essentia-dj-v1",
  attempt: 1,
  leaseToken: "lease",
};

beforeEach(() => {
  vi.clearAllMocks();
  soundcloud.track.mockResolvedValue({ streamable: true, duration: 10_000 });
  soundcloud.resolveTrackStreamUrl.mockResolvedValue("https://cdn.example/audio.mp3");
  const signal = new Float32Array(10 * ANALYSIS_SAMPLE_RATE);
  for (let index = 0; index < signal.length; index += Math.floor(ANALYSIS_SAMPLE_RATE / 2)) {
    signal[index] = 1;
  }
  decoder.decodeUrlToMonoPcm.mockResolvedValue(signal);
});

describe("analysis worker job", () => {
  it("resolves, decodes, analyzes, and returns versioned result", async () => {
    const result = await processAnalysisJob(job);
    expect(soundcloud.track).toHaveBeenCalledWith("12", undefined);
    expect(soundcloud.resolveTrackStreamUrl).toHaveBeenCalledWith("12", undefined, 15_000, false);
    expect(decoder.decodeUrlToMonoPcm).toHaveBeenCalledWith("https://cdn.example/audio.mp3");
    expect(result.sourceTrackId).toBe("12");
    expect(result.analysisVersion).toBe("essentia-dj-v1");
    expect(result.durationSec).toBeCloseTo(10, 3);
  }, 10_000);

  it("rejects oversized tracks before stream download", async () => {
    soundcloud.track.mockResolvedValue({ streamable: true, duration: 601_000 });
    await expect(processAnalysisJob(job)).rejects.toThrow("10 minute");
    expect(soundcloud.resolveTrackStreamUrl).not.toHaveBeenCalled();
    expect(decoder.decodeUrlToMonoPcm).not.toHaveBeenCalled();
  });

  it("marks missing SoundCloud tracks as permanently non-streamable", async () => {
    const error = Object.assign(new Error("SoundCloud API error 404"), { status: 404 });
    soundcloud.track.mockRejectedValue(error);

    await expect(processAnalysisJob(job)).rejects.toThrow(
      "[NON_STREAMABLE] SoundCloud API error 404",
    );
    expect(soundcloud.resolveTrackStreamUrl).not.toHaveBeenCalled();
    expect(decoder.decodeUrlToMonoPcm).not.toHaveBeenCalled();
  });

  it("reuses a parent-provided SoundCloud token", async () => {
    await processAnalysisJob(job, { soundCloudAccessToken: "shared-token" });
    expect(soundcloud.track).toHaveBeenCalledWith("12", "shared-token");
    expect(soundcloud.resolveTrackStreamUrl).toHaveBeenCalledWith("12", "shared-token", 15_000, false);
  });

  it("enriches current musical segments with model predictions", async () => {
    const result = await processAnalysisJob(
      { ...job, analysisVersion: TRACK_ANALYSIS_VERSION },
      { semanticPredictor: async () => ({ mirexMood: { cheerful: 0.8 }, vocalProbability: 0.65 }) },
    );
    expect(result.segments[0]).toMatchObject({
      mirexMood: { cheerful: 0.8 },
      vocalProbability: 0.65,
    });
    expect(result.semantic).toMatchObject({
      windowSec: 10,
      hopSec: 5,
      status: "ready",
    });
  }, 10_000);

  it("keeps analysis usable when semantic models are unavailable", async () => {
    const result = await processAnalysisJob(
      { ...job, analysisVersion: TRACK_ANALYSIS_VERSION },
      { semanticPredictor: async () => { throw new Error("models missing"); } },
    );
    expect(result.segments[0].mirexMood).toBeNull();
    expect(result.warnings).toContain("semantic inference unavailable: models missing");
    expect(result.semantic?.status).toBe("unavailable");
  }, 10_000);
});
