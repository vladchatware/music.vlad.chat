import fs from "node:fs/promises";
import path from "node:path";

export type PlaybackLogEntry = {
  ts: string;
  event: string;
  payload?: Record<string, unknown>;
};

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "playback-debug.ndjson");

let writeChain: Promise<void> = Promise.resolve();

export const getPlaybackLogFilePath = () => LOG_FILE;

export async function appendPlaybackLogs(entries: PlaybackLogEntry[], source: string) {
  if (entries.length === 0) return;

  const lines =
    entries
      .map((entry) =>
        JSON.stringify({
          ...entry,
          source,
          receivedAt: new Date().toISOString(),
        }),
      )
      .join("\n") + "\n";

  writeChain = writeChain.then(async () => {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, lines, "utf8");
  });
  await writeChain;
}

export async function readPlaybackLogsTail(limit: number) {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const slice = lines.slice(-Math.max(1, limit));
    return slice.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parseError: true, raw: line };
      }
    });
  } catch {
    return [];
  }
}
