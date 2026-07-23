export const MAX_DJ_AGENT_STEPS = 5;
// Leave enough wall-clock headroom for model output, track fetch, decode, and cueing.
// This is the research cutoff checked between model steps, not the browser's
// physical transition deadline.
export const DJ_PLAYER_DECISION_DEADLINE_MS = 30_000;

export type DJAgentRunMode =
  | "fresh_discovery"
  | "recovery"
  | "prepared_selection"
  | "post_player_preparation";

type ForcedToolChoice<T extends string = string> = {
  type: "tool";
  toolName: T;
};

export function getBoundedDJToolChoice<T extends string>(input: {
  stepNumber: number;
  maxSteps: number;
  policyChoice: ForcedToolChoice<T> | undefined;
  elapsedMs?: number;
  decisionDeadlineMs?: number;
}): ForcedToolChoice<T | "player"> | undefined {
  if (
    input.stepNumber >= input.maxSteps - 1 ||
    (input.decisionDeadlineMs !== undefined &&
      (input.elapsedMs ?? 0) >= input.decisionDeadlineMs)
  ) {
    return { type: "tool", toolName: "player" };
  }
  return input.policyChoice;
}

export function getDJAgentToolChoice<T extends string = never>(input: {
  mode: DJAgentRunMode;
  stepNumber: number;
  maxSteps: number;
  policyChoice: ForcedToolChoice<T> | undefined;
  elapsedMs?: number;
  decisionDeadlineMs?: number;
  recoveryStateRefreshed?: boolean;
  postPlayerAnalysisScheduled?: boolean;
  postPlayerScheduleWasRequired?: boolean;
}): ForcedToolChoice<T | "dj_state" | "player" | "track_analysis" | "schedule_track_analysis"> | undefined {
  if (input.mode === "recovery") {
    return input.recoveryStateRefreshed
      ? { type: "tool", toolName: "player" }
      : { type: "tool", toolName: "dj_state" };
  }
  if (input.mode === "prepared_selection") {
    return { type: "tool", toolName: "player" };
  }
  if (input.mode === "post_player_preparation") {
    if (input.postPlayerAnalysisScheduled === false) {
      return { type: "tool", toolName: "schedule_track_analysis" };
    }
    const maxAnalysisStep = input.postPlayerScheduleWasRequired ? 3 : 2;
    return input.stepNumber < maxAnalysisStep
      ? { type: "tool", toolName: "track_analysis" }
      : undefined;
  }
  return getBoundedDJToolChoice(input);
}

export function hasUsablePostPlayerAnalysis({ steps }: { steps: unknown[] }): boolean {
  const latest = steps.at(-1);
  if (!latest || typeof latest !== "object") return false;
  const toolResults = (latest as { toolResults?: unknown }).toolResults;
  if (!Array.isArray(toolResults)) return false;
  return toolResults.some((result) => {
    if (!result || typeof result !== "object") return false;
    const record = result as Record<string, unknown>;
    if (record.toolName !== "track_analysis") return false;
    const output = record.output;
    return !(
      output &&
      typeof output === "object" &&
      (output as Record<string, unknown>).status === "rejected_selected_track"
    );
  });
}

export function classifyAgentTurnOutcome(input: {
  stepCount: number;
  maxSteps: number;
  toolNames: string[];
  finishReason: string;
}): { outcome: "completed" } | { outcome: "failed"; reason: "agent_holding_loop" } {
  if (
    !input.toolNames.includes("player") &&
    input.stepCount >= input.maxSteps
  ) {
    return { outcome: "failed", reason: "agent_holding_loop" };
  }
  return { outcome: "completed" };
}
