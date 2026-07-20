import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANALYSIS_SAMPLE_RATE } from "./config";

export const FFMPEG_DECODE_TIMEOUT_MS = 10 * 60_000;
export const ffmpegDecodeSpawnOptions = {
  stdio: ["ignore", "ignore", "pipe"] as ["ignore", "ignore", "pipe"],
  timeout: FFMPEG_DECODE_TIMEOUT_MS,
  killSignal: "SIGKILL" as const,
};

export async function decodeUrlToMonoPcm(audioUrl: string): Promise<Float32Array> {
  const dir = await mkdtemp(join(tmpdir(), "music-vlad-analysis-"));
  const outputPath = join(dir, "audio.f32le");
  try {
    const child = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        audioUrl,
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(ANALYSIS_SAMPLE_RATE),
        "-f",
        "f32le",
        outputPath,
      ],
      ffmpegDecodeSpawnOptions,
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2_000) stderr += chunk;
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (exitCode !== 0) {
      throw new Error(`FFmpeg decode failed (${exitCode}): ${stderr.slice(0, 300)}`);
    }

    const bytes = await readFile(outputPath);
    if (bytes.byteLength < 4) throw new Error("Decoded audio is empty");
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength - (bytes.byteLength % 4),
    );
    return new Float32Array(copy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
