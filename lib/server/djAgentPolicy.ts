import { getDiscoveredTrackIds } from "@/lib/dj/discoveryCandidates";

type RequiredToolName = "dj_state" | "likes" | "tracks" | "schedule_track_analysis";
type ToolChoice = { type: "tool"; toolName: RequiredToolName };

type ToolEvent = { name: string; failedPlayer: boolean };

export { getDiscoveredTrackIds };

function getToolOutputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(getToolOutputText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (record.type === "text" && typeof record.value === "string") return record.value;
  if (typeof record.text === "string") return record.text;
  if ("output" in record) return getToolOutputText(record.output);
  if ("content" in record) return getToolOutputText(record.content);
  return "";
}

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

export function hasDJToolCall(value: unknown, toolName: string): boolean {
  const names = new Set<string>();
  collectToolNames(value, names, new Set());
  return names.has(toolName);
}

export function hasDJToolCallAfterLatestRejectedPlayer(
  value: unknown,
  toolName: string,
): boolean {
  const events: ToolEvent[] = [];
  collectToolEvents(value, events, new Set());
  const rejectedPlayerIndex = events.findLastIndex((event) => event.failedPlayer);
  return rejectedPlayerIndex >= 0 && events
    .slice(rejectedPlayerIndex + 1)
    .some((event) => event.name === toolName);
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
    const output = getToolOutputText(record.output);
    events.push({
      name,
      failedPlayer:
        name === "player" &&
        /Player rejected (?:track|timeline)|Duplicate player request ignored/i.test(output),
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

export function getLatestCandidateTrackIds(value: unknown): number[] {
  let latest: number[] = [];
  const visit = (node: unknown, seen: Set<object>) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.candidateTrackIds)) {
      latest = record.candidateTrackIds.filter(
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

export function getLatestSetQueueTrackIds(value: unknown): number[] {
  let latest: number[] = [];
  const visit = (node: unknown, seen: Set<object>) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.plannedTrackIds)) {
      latest = record.plannedTrackIds.filter(
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

export function getLatestCommittedSetQueueTrackId(value: unknown): number | null {
  let latest: number | null = null;
  const visit = (node: unknown, seen: Set<object>) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    const committed = record.committed;
    if (committed && typeof committed === "object") {
      const request = (committed as Record<string, unknown>).request;
      const id = request && typeof request === "object"
        ? (request as Record<string, unknown>).id
        : undefined;
      if (typeof id === "number" && Number.isInteger(id) && id > 0) latest = id;
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
  return latest;
}

export function shouldUsePreparedCandidatePool(value: unknown): boolean {
  return getLatestCandidateTrackIds(value).length > 0;
}

export function hasSuccessfulPlayerAction(value: unknown): boolean {
  let accepted = false;
  const visit = (node: unknown, seen: Set<object>) => {
    if (accepted || !node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    const name =
      record.toolName === "player" || record.type === "tool-player"
        ? "player"
        : null;
    const output = getToolOutputText(record.output);
    if (name === "player" && /^(Playing|Queued)\s+\d+/i.test(output)) {
      accepted = true;
      return;
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
  return accepted;
}

export function hasRejectedPlayerAction(value: unknown): boolean {
  let rejected = false;
  const visit = (node: unknown, seen: Set<object>) => {
    if (rejected || !node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    const name =
      record.toolName === "player" || record.type === "tool-player"
        ? "player"
        : null;
    if (
      name === "player" &&
      /Player rejected track|Duplicate player request ignored/i.test(
        getToolOutputText(record.output),
      )
    ) {
      rejected = true;
      return;
    }
    if (
      name === "player" &&
      /Player rejected timeline/i.test(
        getToolOutputText(record.output),
      )
    ) {
      rejected = true;
      return;
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
  return rejected;
}

export function getLatestSuccessfulPlayerTrackId(value: unknown): number | null {
  let latest: number | null = null;
  const visit = (node: unknown, seen: Set<object>) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    const name =
      record.toolName === "player" || record.type === "tool-player"
        ? "player"
        : null;
    if (name === "player") {
      const match = /^(?:Playing|Queued)\s+(\d+)/i.exec(
        getToolOutputText(record.output),
      );
      if (match) latest = Number(match[1]);
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
  return latest;
}

export type DJAgentMode =
  | "fresh_discovery"
  | "recovery"
  | "prepared_selection"
  | "post_player_preparation";

export function getDJAgentMode(value: unknown): DJAgentMode {
  if (hasSuccessfulPlayerAction(value)) return "post_player_preparation";
  if (hasRejectedPlayerAction(value)) return "recovery";
  if (
    shouldUsePreparedCandidatePool(value) ||
    getDiscoveredTrackIds(value).length > 0
  ) {
    return "prepared_selection";
  }
  return "fresh_discovery";
}

export function requiresExploration(text: string): boolean {
  return /\b(similar(?:\s+tracks?)?|discover(?:y|ing)?|explor(?:e|ation|ing)|beyond\s+(?:my\s+)?likes?)\b/i.test(text);
}

export function createDJAgentStepPolicy(
  messages: unknown,
  opts: { hasInitialDJState?: boolean } = {},
) {
  const calledTools = new Set<string>();
  collectToolNames(messages, calledTools, new Set());
  if (opts.hasInitialDJState) calledTools.add("dj_state");
  const toolEvents: ToolEvent[] = [];
  collectToolEvents(messages, toolEvents, new Set());
  const explorationRequired = requiresExploration(getLatestUserText(messages));
  const hasPreparedCandidates = getLatestCandidateTrackIds(messages).length > 0;

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
    if (hasPreparedCandidates) return undefined;
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
