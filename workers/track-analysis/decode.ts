import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANALYSIS_SAMPLE_RATE } from "./config";

export async function decodeUrlToMonoPcm(
  audioUrl: string,
  authToken?: string,
): Promise<Float32Array> {
  const dir = await mkdtemp(join(tmpdir(), "music-vlad-analysis-"));
  const outputPath = join(dir, "audio.f32le");
  try {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
    ];
    if (authToken) {
      // SoundCloud serves full-length audio over HLS today; the master
      // playlist lives behind api.soundcloud.com and requires the bearer
      // token. ffmpeg forwards these headers on every request.
      args.push("-headers", `Authorization: Bearer ${authToken}\r\n`);
    }
    args.push(
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
    );
    const child = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      args,
      { stdio: ["ignore", "ignore", "pipe"] },
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
