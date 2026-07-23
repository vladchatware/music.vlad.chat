import type { UIMessage } from "ai";

export function getScheduledCandidateIds(messages: UIMessage[]): number[] {
  const ids: number[] = [];
  const visit = (value: unknown, scheduledContext: boolean, seen: Set<object>) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const isSchedule =
      scheduledContext ||
      record.toolName === "schedule_track_analysis" ||
      (typeof record.type === "string" && record.type.includes("schedule_track_analysis"));
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
