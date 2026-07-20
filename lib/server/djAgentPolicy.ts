type RequiredToolName = "dj_state" | "likes" | "tracks" | "schedule_track_analysis";
type ToolChoice = { type: "tool"; toolName: RequiredToolName };

type ToolEvent = { name: string; failedPlayer: boolean };

function collectToolNames(value: unknown, names: Set<string>, seen: Set<object>) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  const record = value as Record<string, unknown>;
  if (typeof record.toolName === "string") names.add(record.toolName);
  if (typeof record.type === "string" && record.type.startsWith("tool-")) {
    names.add(record.type.slice("tool-".length));
  }

  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) collectToolNames(item, names, seen);
    } else {
      collectToolNames(child, names, seen);
    }
  }
}

function collectToolEvents(value: unknown, events: ToolEvent[], seen: Set<object>) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  const record = value as Record<string, unknown>;
  const name =
    typeof record.toolName === "string"
      ? record.toolName
      : typeof record.type === "string" && record.type.startsWith("tool-")
        ? record.type.slice("tool-".length)
        : undefined;
  if (name) {
    const output = typeof record.output === "string" ? record.output : "";
    events.push({
      name,
      failedPlayer:
        name === "player" &&
        /Player rejected track|Duplicate player request ignored/i.test(output),
    });
  }

  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) collectToolEvents(item, events, seen);
    } else {
      collectToolEvents(child, events, seen);
    }
  }
}

export function getLatestUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "user") continue;
    if (typeof record.content === "string") return record.content;
    if (!Array.isArray(record.parts)) return "";
    return record.parts
      .filter((part): part is { type: "text"; text: string } =>
        Boolean(
          part &&
          typeof part === "object" &&
          (part as Record<string, unknown>).type === "text" &&
          typeof (part as Record<string, unknown>).text === "string",
        ),
      )
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

export function getLatestPlayedTrackIds(value: unknown): number[] {
  let latest: number[] = [];
  const visit = (node: unknown, seen: Set<object>) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.playedTrackIds)) {
      latest = record.playedTrackIds.filter(
        (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0,
      );
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        for (const item of child) visit(item, seen);
      } else {
        visit(child, seen);
      }
    }
  };
  visit(value, new Set());
  return [...new Set(latest)];
}

export function requiresExploration(text: string): boolean {
  return /\b(similar(?:\s+tracks?)?|discover(?:y|ing)?|explor(?:e|ation|ing)|beyond\s+(?:my\s+)?likes?)\b/i.test(text);
}

export function createDJAgentStepPolicy(messages: unknown) {
  const calledTools = new Set<string>();
  collectToolNames(messages, calledTools, new Set());
  const toolEvents: ToolEvent[] = [];
  collectToolEvents(messages, toolEvents, new Set());
  const explorationRequired = requiresExploration(getLatestUserText(messages));

  const nextRequiredTool = (): ToolChoice | undefined => {
    const failedPlayerIndex = toolEvents.findLastIndex((event) => event.failedPlayer);
    if (failedPlayerIndex >= 0) {
      const freshStateIndex = toolEvents.findLastIndex((event) => event.name === "dj_state");
      if (freshStateIndex <= failedPlayerIndex) {
        return { type: "tool", toolName: "dj_state" };
      }

      const refreshTool = explorationRequired ? "tracks" : "likes";
      const refreshIndex = toolEvents.findLastIndex((event) => event.name === refreshTool);
      if (refreshIndex <= failedPlayerIndex) {
        return { type: "tool", toolName: refreshTool };
      }
    }

    if (!calledTools.has("dj_state")) return { type: "tool", toolName: "dj_state" };
    if (!explorationRequired) return undefined;
    if (!calledTools.has("likes")) return { type: "tool", toolName: "likes" };
    if (!calledTools.has("tracks")) return { type: "tool", toolName: "tracks" };
    if (!calledTools.has("schedule_track_analysis")) {
      return { type: "tool", toolName: "schedule_track_analysis" };
    }
    return undefined;
  };

  const recordStep = (step: unknown) => {
    collectToolNames(step, calledTools, new Set());
    collectToolEvents(step, toolEvents, new Set());
  };

  return {
    explorationRequired,
    calledTools,
    nextRequiredTool,
    recordStep,
  };
}
