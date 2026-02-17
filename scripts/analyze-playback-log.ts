import fs from "node:fs/promises";
import path from "node:path";

type LogLine = {
  ts?: string;
  event?: string;
  payload?: Record<string, unknown>;
  source?: string;
};

const logPath = path.join(process.cwd(), "logs", "playback-debug.ndjson");

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function main() {
  let raw = "";
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch {
    console.log(`No log file found at ${logPath}`);
    process.exit(0);
  }

  const entries: LogLine[] = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    })
    .filter((entry) => typeof entry.event === "string");

  if (entries.length === 0) {
    console.log(`No valid entries in ${logPath}`);
    process.exit(0);
  }

  const eventCounts = new Map<string, number>();
  for (const entry of entries) {
    const event = entry.event as string;
    eventCounts.set(event, (eventCounts.get(event) ?? 0) + 1);
  }

  const previewSuspected = entries.filter((e) => e.event === "engine.stream.preview_suspected");
  const streamClassified = entries.filter((e) => e.event === "soundcloud.stream.resolve.classified");
  const streamPreviewClassified = streamClassified.filter(
    (e) => e.payload?.preview === true,
  );
  const streamNonPreviewClassified = streamClassified.filter(
    (e) => e.payload?.preview === false,
  );
  const routeResolved = entries.filter((e) => e.event === "stream.route.resolved");
  const routePreviewResolved = routeResolved.filter((e) => e.payload?.preview === true);
  const crossfadeStarts = entries.filter((e) => e.event === "engine.crossfade.starting");
  const forceStarts = entries.filter((e) => e.event === "engine.transition.force_start_short_remaining");
  const autoCue = entries.filter((e) => e.event === "engine.auto_cue.trigger");

  const overSizedCrossfades = crossfadeStarts.filter((e) => {
    const p = e.payload ?? {};
    const planned = asNumber(p.plannedCrossfadeDurationSec);
    const incoming = asNumber(p.incomingDurationSec);
    return planned !== null && incoming !== null && planned > incoming;
  });

  const autoCuePositions = autoCue
    .map((e) => asNumber(e.payload?.currentTimeSec))
    .filter((n): n is number => n !== null);
  const avgAutoCueSec =
    autoCuePositions.length > 0
      ? autoCuePositions.reduce((sum, n) => sum + n, 0) / autoCuePositions.length
      : null;

  console.log(`Log file: ${logPath}`);
  console.log(`Total entries: ${entries.length}`);
  console.log(`Preview suspected events: ${previewSuspected.length}`);
  console.log(`Stream classified (server): ${streamClassified.length}`);
  console.log(`Stream classified preview=true: ${streamPreviewClassified.length}`);
  console.log(`Stream classified preview=false: ${streamNonPreviewClassified.length}`);
  console.log(`Stream route resolved preview=true: ${routePreviewResolved.length}`);
  console.log(`Crossfade starts: ${crossfadeStarts.length}`);
  console.log(`Forced short-remaining starts: ${forceStarts.length}`);
  console.log(`Oversized planned crossfades: ${overSizedCrossfades.length}`);
  console.log(
    `Average auto-cue trigger time: ${
      avgAutoCueSec === null ? "n/a" : `${avgAutoCueSec.toFixed(2)}s`
    }`,
  );

  const topEvents = Array.from(eventCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  console.log("\nTop events:");
  for (const [event, count] of topEvents) {
    console.log(`- ${event}: ${count}`);
  }

  if (previewSuspected.length > 0) {
    const sample = previewSuspected.slice(-3);
    console.log("\nRecent preview suspects:");
    for (const item of sample) {
      const payload = item.payload ?? {};
      console.log(
        `- track=${payload.trackId ?? "?"} meta=${payload.trackMetaDurationSec ?? "?"}s stream=${payload.deckDurationSec ?? "?"}s`,
      );
    }
  }

  if (streamPreviewClassified.length > 0) {
    const sample = streamPreviewClassified.slice(-3);
    console.log("\nRecent stream preview classifications:");
    for (const item of sample) {
      const payload = item.payload ?? {};
      console.log(
        `- track=${payload.trackId ?? "?"} token=${payload.tokenSource ?? "?"} host=${payload.host ?? "?"}`,
      );
    }
  }
}

void main();
