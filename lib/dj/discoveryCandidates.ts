function collectPositiveIds(value: unknown, ids: number[], seen: Set<object>) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (
    typeof record.id === "number" &&
    Number.isInteger(record.id) &&
    record.id > 0
  ) {
    ids.push(record.id);
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) collectPositiveIds(item, ids, seen);
    } else {
      collectPositiveIds(child, ids, seen);
    }
  }
}

function collectLeadingTrackIds(value: unknown, ids: number[], seen: Set<object>) {
  if (typeof value === "string") {
    for (const line of value.split(/\r?\n/)) {
      const match = /^\s*(\d+)(?:\s|$)/.exec(line);
      if (!match) continue;
      const id = Number(match[1]);
      if (Number.isSafeInteger(id) && id > 0) ids.push(id);
    }
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(child)) {
      for (const item of child) collectLeadingTrackIds(item, ids, seen);
    } else {
      collectLeadingTrackIds(child, ids, seen);
    }
  }
}

/** IDs are playable only when returned as output from SoundCloud discovery. */
export function getDiscoveredTrackIds(value: unknown): number[] {
  const ids: number[] = [];
  const visit = (node: unknown, seen: Set<object>) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    const name =
      typeof record.toolName === "string"
        ? record.toolName
        : typeof record.type === "string" && record.type.startsWith("tool-")
          ? record.type.slice("tool-".length)
          : undefined;
    if ((name === "likes" || name === "tracks") && "output" in record) {
      collectPositiveIds(record.output, ids, new Set());
      collectLeadingTrackIds(record.output, ids, new Set());
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
  return [...new Set(ids)];
}
