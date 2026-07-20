import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeUrlToMonoPcm,
  FFMPEG_DECODE_TIMEOUT_MS,
  ffmpegDecodeSpawnOptions,
} from "./decode";
import { ANALYSIS_SAMPLE_RATE } from "./config";

let fixtureDir: string | null = null;

afterEach(async () => {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  fixtureDir = null;
});

describe("FFmpeg decoder", () => {
  it("force-kills stalled FFmpeg decodes before the analysis lease expires", () => {
    expect(FFMPEG_DECODE_TIMEOUT_MS).toBeLessThan(15 * 60_000);
    expect(ffmpegDecodeSpawnOptions).toMatchObject({
      timeout: FFMPEG_DECODE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
  });

  it("decodes input to mono 22.05 kHz PCM", async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "music-vlad-decode-test-"));
    const fixture = join(fixtureDir, "tone.wav");
    const create = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1:sample_rate=44100",
      "-y",
      fixture,
    ]);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      create.once("error", reject);
      create.once("close", resolve);
    });
    expect(exitCode).toBe(0);

    const signal = await decodeUrlToMonoPcm(fixture);
    expect(signal.length).toBeGreaterThanOrEqual(ANALYSIS_SAMPLE_RATE - 2);
    expect(signal.length).toBeLessThanOrEqual(ANALYSIS_SAMPLE_RATE + 2);
    expect(Math.max(...signal.slice(0, 1000))).toBeGreaterThan(0);
  });
});
