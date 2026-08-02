import { describe, expect, it } from "vitest";

import {
  classifyAgentTurnOutcome,
  DJ_PLAYER_DECISION_DEADLINE_MS,
  getDJAgentToolChoice,
  getBoundedDJToolChoice,
  hasUsablePostPlayerAnalysis,
  MAX_DJ_AGENT_STEPS,
  getDJRequestTimeoutMs,
} from "./agentSessionLimit";

describe("getDJRequestTimeoutMs", () => {
  it("inherits the browser session's exact remaining time", () => {
    expect(getDJRequestTimeoutMs(136_941.2)).toBe(136_942);
  });

  it("adds no independent timeout when the browser has no finite deadline", () => {
    expect(getDJRequestTimeoutMs(undefined)).toBeUndefined();
    expect(getDJRequestTimeoutMs(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe("classifyAgentTurnOutcome", () => {
  it("marks exhausted tool-step budget without player action as agent holding loop", () => {
    expect(
      classifyAgentTurnOutcome({
        stepCount: 12,
        maxSteps: 12,
        toolNames: ["dj_state", "likes", "track_analysis"],
        finishReason: "tool-calls",
      }),
    ).toEqual({ outcome: "failed", reason: "agent_holding_loop" });
  });

  it("does not call a successful player action holding loop", () => {
    expect(
      classifyAgentTurnOutcome({
        stepCount: 12,
        maxSteps: 12,
        toolNames: ["dj_state", "track_analysis", "player"],
        finishReason: "tool-calls",
      }),
    ).toEqual({ outcome: "completed" });
  });

  it("allows bounded analysis calls below step limit", () => {
    expect(
      classifyAgentTurnOutcome({
        stepCount: 7,
        maxSteps: 12,
        toolNames: ["likes", "track_analysis", "track_analysis"],
        finishReason: "stop",
      }),
    ).toEqual({ outcome: "completed" });
  });

  it("allows a client-tool handoff below the server step cap", () => {
    expect(
      classifyAgentTurnOutcome({
        stepCount: 6,
        maxSteps: 12,
        toolNames: ["likes", "tracks", "track_analysis"],
        finishReason: "tool-calls",
      }),
    ).toEqual({ outcome: "completed" });
  });

});

describe("getBoundedDJToolChoice", () => {
  it("forces player on final allowed model step", () => {
    expect(
      getBoundedDJToolChoice({
        stepNumber: 5,
        maxSteps: 6,
        policyChoice: { type: "tool", toolName: "track_analysis" },
      }),
    ).toEqual({ type: "tool", toolName: "player" });
  });

  it("reserves the remaining request time for a player decision", () => {
    expect(
      getBoundedDJToolChoice({
        stepNumber: 2,
        maxSteps: 5,
        policyChoice: undefined,
        elapsedMs: 31_000,
        decisionDeadlineMs: 30_000,
      }),
    ).toEqual({ type: "tool", toolName: "player" });
  });

  it("preserves normal tool choice before final step", () => {
    expect(
      getBoundedDJToolChoice({
        stepNumber: 4,
        maxSteps: 6,
        policyChoice: { type: "tool", toolName: "tracks" },
      }),
    ).toEqual({ type: "tool", toolName: "tracks" });
  });
});

describe("getDJAgentToolChoice", () => {
  it("forces prepared pool selection on the first step", () => {
    expect(
      getDJAgentToolChoice({
        mode: "prepared_selection",
        stepNumber: 0,
        maxSteps: MAX_DJ_AGENT_STEPS,
        policyChoice: undefined,
      }),
    ).toEqual({ type: "tool", toolName: "player" });
  });

  it("uses session history, not request-local step count, to advance recovery", () => {
    expect(getDJAgentToolChoice({
      mode: "recovery",
      stepNumber: 0,
      maxSteps: MAX_DJ_AGENT_STEPS,
      policyChoice: undefined,
      elapsedMs: 60_000,
      decisionDeadlineMs: DJ_PLAYER_DECISION_DEADLINE_MS,
      recoveryStateRefreshed: false,
    })).toEqual({ type: "tool", toolName: "dj_state" });

    expect(getDJAgentToolChoice({
      mode: "recovery",
      stepNumber: 0,
      maxSteps: MAX_DJ_AGENT_STEPS,
      policyChoice: undefined,
      elapsedMs: 60_000,
      decisionDeadlineMs: DJ_PLAYER_DECISION_DEADLINE_MS,
      recoveryStateRefreshed: true,
    })).toEqual({ type: "tool", toolName: "player" });
  });

  it("refreshes candidates after recovery state before retrying player", () => {
    expect(getDJAgentToolChoice({
      mode: "recovery",
      stepNumber: 0,
      maxSteps: MAX_DJ_AGENT_STEPS,
      policyChoice: { type: "tool", toolName: "tracks" },
      recoveryStateRefreshed: true,
    })).toEqual({ type: "tool", toolName: "tracks" });
  });

  it("starts next-track analysis immediately after an accepted player action", () => {
    expect(
      getDJAgentToolChoice({
        mode: "post_player_preparation",
        stepNumber: 0,
        maxSteps: 5,
        policyChoice: undefined,
      }),
    ).toEqual({ type: "tool", toolName: "track_analysis" });
  });

  it("queues analysis first when discovery did not schedule candidates", () => {
    expect(
      getDJAgentToolChoice({
        mode: "post_player_preparation",
        stepNumber: 0,
        maxSteps: 5,
        policyChoice: undefined,
        postPlayerAnalysisScheduled: false,
        postPlayerScheduleWasRequired: true,
      }),
    ).toEqual({ type: "tool", toolName: "schedule_track_analysis" });
  });

  it("allows only one corrective analysis attempt", () => {
    expect(
      getDJAgentToolChoice({
        mode: "post_player_preparation",
        stepNumber: 1,
        maxSteps: 5,
        policyChoice: undefined,
      }),
    ).toEqual({ type: "tool", toolName: "track_analysis" });
    expect(
      getDJAgentToolChoice({
        mode: "post_player_preparation",
        stepNumber: 2,
        maxSteps: 5,
        policyChoice: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("hasUsablePostPlayerAnalysis", () => {
  it("stops after analyzing a future candidate", () => {
    expect(hasUsablePostPlayerAnalysis({
      steps: [{ toolResults: [{ toolName: "track_analysis", output: { status: "ready" } }] }],
    })).toBe(true);
  });

  it("allows one retry after the queued track is rejected", () => {
    expect(hasUsablePostPlayerAnalysis({
      steps: [{ toolResults: [{ toolName: "track_analysis", output: { status: "rejected_selected_track" } }] }],
    })).toBe(false);
  });
});
