import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface TraceEvent {
  sequence: number;
  wallTime: string;
  wallElapsedMs: number;
  simulatedTimeSec: number;
  type: string;
  [key: string]: unknown;
}

function modelText(value: string): string {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => `  model> ${line}`)
    .join("\n");
}

export function formatTraceEvent(event: TraceEvent): string {
  const minutes = Math.floor(event.simulatedTimeSec / 60);
  const seconds = (event.simulatedTimeSec % 60).toFixed(1).padStart(4, "0");
  const heading = `[${String(minutes).padStart(2, "0")}:${seconds}] ${event.type}`;
  if (event.type === "agent.step" && typeof event.text === "string" && event.text.trim()) {
    return `${heading}\n${modelText(event.text)}`;
  }
  const detail =
    typeof event.tool === "string"
      ? ` ${event.tool}`
      : typeof event.trackId === "number"
        ? ` track=${event.trackId}`
        : "";
  return `${heading}${detail}`;
}

export class TraceRecorder {
  private sequence = 0;
  private readonly startedAt = performance.now();

  constructor(
    readonly path: string,
    private readonly quiet = false,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
  }

  record(
    type: string,
    simulatedTimeSec: number,
    details: Record<string, unknown> = {},
  ): TraceEvent {
    const event: TraceEvent = {
      sequence: ++this.sequence,
      wallTime: new Date().toISOString(),
      wallElapsedMs: Math.round(performance.now() - this.startedAt),
      simulatedTimeSec: Math.round(simulatedTimeSec * 1_000) / 1_000,
      type,
      ...details,
    };
    appendFileSync(this.path, `${JSON.stringify(event)}\n`);
    if (!this.quiet) this.print(event);
    return event;
  }

  get events(): readonly TraceEvent[] {
    const contents = readFileSync(this.path, "utf8").trim();
    if (!contents) return [];
    return contents.split("\n").map((line) => JSON.parse(line) as TraceEvent);
  }

  private print(event: TraceEvent) {
    process.stderr.write(`${formatTraceEvent(event)}\n`);
  }
}
