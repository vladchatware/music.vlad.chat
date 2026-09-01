import type { UIMessage } from "ai";
import { getDiscoveredTrackIds } from "@/lib/dj/discoveryCandidates";

export function getPlayableCandidateIds(messages: UIMessage[]): number[] {
  return [...new Set([
    ...getDiscoveredTrackIds(messages),
    ...getScheduledCandidateIds(messages),
  ])];
}

export function getScheduledCandidateIds(messages: UIMessage[]): number[] {
  const ids: number[] = [];
  const visit = (value: unknown, scheduledContext: boolean, seen: Set<object>) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const isScheduleTool =
      record.toolName === "schedule_track_analysis" ||
      (typeof record.type === "string" && record.type.includes("schedule_track_analysis"));
    // Streamed tool inputs can contain only a numeric prefix when playback moves
    // to the next deck and aborts the response (for example 719 from 719940358).
    // Only a completed schedule result is authoritative candidate evidence.
    const isSchedule = scheduledContext || (
      isScheduleTool && record.state === "output-available"
    );
    if (isSchedule && Array.isArray(record.ids)) {
      for (const id of record.ids) {
        if (typeof id === "number" && Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
      }
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        for (const item of child) visit(item, isSchedule, seen);
      } else {
        visit(child, isSchedule, seen);
      }
    }
  };
  visit(messages, false, new Set());
  return ids;
}
