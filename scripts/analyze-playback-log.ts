import fs from "node:fs/promises";
import path from "node:path";

type LogLine = {
  ts?: string;
  event?: string;
  payload?: Record<string, unknown>;
  source?: string;
  sessionId?: string;
  chatSessionId?: string;
  turnId?: string;
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

  const sessions = new Map<string, LogLine[]>();
  for (const entry of entries) {
    const id = entry.sessionId ?? "legacy/unscoped";
    const group = sessions.get(id) ?? [];
    group.push(entry);
    sessions.set(id, group);
  }
  const chatSessions = new Set(entries.map((entry) => entry.chatSessionId).filter(Boolean));
  const chatTurns = new Set(entries.map((entry) => entry.turnId).filter(Boolean));

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
  const planned = entries.filter((e) => e.event === "engine.transition.planned");
  const agentPlans = planned.filter((e) => e.payload?.performanceSource === "agent");
  const performanceLoops = entries.filter((e) => e.event === "engine.performance.loop");
  const rejectedPlans = entries.filter((e) => e.event === "chat.tool_call.player_rejected");
  const outcomes = entries.filter((e) => e.event === "engine.transition.outcome");
  const aborted = outcomes.filter((e) => e.payload?.transitionOutcome !== "completed");
  const listeningSegments = entries.filter((e) => e.event === "engine.listening.segment");

  const average = (values: number[]): number | null =>
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const energyMismatches = crossfadeStarts
    .map((e) => asNumber(e.payload?.handoffEnergyMismatch))
    .filter((value): value is number => value !== null);
  const timingDrifts = crossfadeStarts
    .map((e) => asNumber(e.payload?.timingDriftSec))
    .filter((value): value is number => value !== null);
  const uninterruptedDurations = listeningSegments
    .map((e) => asNumber(e.payload?.durationSec))
    .filter((value): value is number => value !== null);

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
  console.log(`Runtime sessions: ${sessions.size}`);
  console.log(`Chat sessions: ${chatSessions.size}`);
  console.log(`AI DJ turns: ${chatTurns.size}`);
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
  console.log(`Agent-authored plans: ${agentPlans.length}/${planned.length}`);
  console.log(`Performance loop repetitions: ${performanceLoops.length}`);
  console.log(`Rejected agent plans: ${rejectedPlans.length}`);
  console.log(`Transition abort/failure outcomes: ${aborted.length}/${outcomes.length}`);
  console.log(`Average handoff energy mismatch: ${average(energyMismatches)?.toFixed(4) ?? "n/a"}`);
  const averageTimingDrift = average(timingDrifts);
  const averageUninterrupted = average(uninterruptedDurations);
  console.log(
    `Average transition timing drift: ${averageTimingDrift === null ? "n/a" : `${averageTimingDrift.toFixed(4)}s`}`,
  );
  console.log(
    `Average uninterrupted playback segment: ${averageUninterrupted === null ? "n/a" : `${averageUninterrupted.toFixed(2)}s`}`,
  );

  const topEvents = Array.from(eventCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  console.log("\nTop events:");
  for (const [event, count] of topEvents) {
    console.log(`- ${event}: ${count}`);
  }


  console.log("\nSession facts:");
  for (const [id, sessionEntries] of Array.from(sessions.entries()).slice(-20)) {
    const transitions = sessionEntries.filter((e) => e.event === "engine.transition.outcome");
    const completed = transitions.filter((e) => e.payload?.transitionOutcome === "completed").length;
    const runtimeErrors = sessionEntries.filter((e) => e.event?.startsWith("runtime.")).length;
    const rejected = sessionEntries.filter((e) => e.event === "chat.tool_call.player_rejected").length;
    const completionRate = transitions.length === 0 ? "n/a" : `${Math.round(completed / transitions.length * 100)}%`;
    console.log(
      `- ${id}: events=${sessionEntries.length} transitions=${transitions.length} completion=${completionRate} runtimeErrors=${runtimeErrors} rejectedPlans=${rejected}`,
    );
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
