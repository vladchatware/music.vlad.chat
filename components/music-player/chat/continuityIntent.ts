export type AgentSessionSource = "planning_window" | "user" | "recovery";
export type AgentSessionState =
  | "requested"
  | "researching"
  | "executing"
  | "action_accepted"
  | "preparing_next";
export type AgentSessionTerminal =
  | "planned"
  | "error"
  | "deadline"
  | "aborted"
  | "agent_holding_loop";
export type AgentSessionFailure = "agent_holding_loop" | "stale_session";
export type AgentTransportStatus = "submitted" | "streaming" | "ready" | "error";

export function classifyAgentSessionTerminal(input: {
  outcome: "completed" | "error" | "aborted" | "agent_holding_loop";
  state: AgentSessionState;
}): AgentSessionTerminal | "awaiting_continuation" {
  if (input.outcome !== "completed") return input.outcome;
  if (input.state === "action_accepted") return "awaiting_continuation";
  if (input.state === "preparing_next") return "planned";
  return "agent_holding_loop";
}

export type AgentSession = {
  id: string;
  revision: number;
  source: AgentSessionSource;
  activeTrackId: number;
  openedAtMs: number;
  deadlineAtMs: number;
  state: AgentSessionState;
};

export function computeAgentSessionDeadlineAtMs(opts: {
  nowMs: number;
  remainingSec: number;
  maxDurationMs?: number;
  safetyMarginMs?: number;
  minDurationMs?: number;
}): number {
  const maxDurationMs = opts.maxDurationMs ?? 70_000;
  const safetyMarginMs = opts.safetyMarginMs ?? 10_000;
  const minDurationMs = opts.minDurationMs ?? 3_000;
  const availableMs = Math.max(
    minDurationMs,
    opts.remainingSec * 1_000 - safetyMarginMs,
  );
  return opts.nowMs + Math.min(maxDurationMs, availableMs);
}

export function computePlaybackAgentSessionDeadlineAtMs(opts: {
  nowMs: number;
  remainingSec: number;
  endedThresholdSec?: number;
  recoveryDurationMs?: number;
}): number {
  const endedThresholdSec = opts.endedThresholdSec ?? 0.25;
  if (!Number.isFinite(opts.remainingSec) || opts.remainingSec <= endedThresholdSec) {
    return opts.nowMs + (opts.recoveryDurationMs ?? 70_000);
  }
  return computeAgentSessionDeadlineAtMs(opts);
}

type OpenInput = {
  source: AgentSessionSource;
  activeTrackId: number;
  deadlineAtMs: number;
};

type ActionInput = {
  sessionId: string;
  activeTrackId: number;
};

export function createContinuityIntentController(opts: {
  generateId?: () => string;
  now?: () => number;
  maxContinuations?: number;
  maxPlayerAttempts?: number;
} = {}) {
  const generateId = opts.generateId ?? (() => crypto.randomUUID());
  const now = opts.now ?? (() => Date.now());
  const maxContinuations = opts.maxContinuations ?? 4;
  const maxPlayerAttempts = opts.maxPlayerAttempts ?? 2;
  let revision = 0;
  let continuationCount = 0;
  let playerAttemptCount = 0;
  let active: AgentSession | null = null;

  const matches = ({ sessionId, activeTrackId }: ActionInput) =>
    active?.id === sessionId && active.activeTrackId === activeTrackId;

  const open = (input: OpenInput) => {
    if (active) {
      return {
        outcome: "failed" as const,
        reason: "agent_holding_loop" as const,
        session: { ...active },
      };
    }
    active = {
      id: generateId(),
      revision: ++revision,
      source: input.source,
      activeTrackId: input.activeTrackId,
      openedAtMs: now(),
      deadlineAtMs: input.deadlineAtMs,
      state: "requested",
    };
    continuationCount = 0;
    playerAttemptCount = 0;
    return { outcome: "opened" as const, session: { ...active } };
  };

  const observeTransport = (status: AgentTransportStatus) => {
    if (!active) return;
    if (
      (status === "submitted" || status === "streaming") &&
      (active.state === "requested" || active.state === "researching")
    ) {
      active.state = "researching";
    }
  };

  const beginPlayerAction = (input: ActionInput) => {
    if (!matches(input)) {
      return { outcome: "failed" as const, reason: "stale_session" as const };
    }
    if (active?.state === "executing" || active?.state === "action_accepted") {
      return {
        outcome: "failed" as const,
        reason: "agent_holding_loop" as const,
      };
    }
    if (active && now() > active.deadlineAtMs) {
      active = null;
      continuationCount = 0;
      playerAttemptCount = 0;
      return {
        outcome: "failed" as const,
        reason: "agent_holding_loop" as const,
      };
    }
    if (playerAttemptCount >= maxPlayerAttempts) {
      active = null;
      continuationCount = 0;
      playerAttemptCount = 0;
      return {
        outcome: "failed" as const,
        reason: "agent_holding_loop" as const,
      };
    }
    playerAttemptCount += 1;
    active!.state = "executing";
    return { outcome: "started" as const };
  };

  const resolvePlayerAction = (
    input: ActionInput & { succeeded: boolean },
  ) => {
    if (!matches(input) || active?.state !== "executing") {
      return { outcome: "failed" as const, reason: "stale_session" as const };
    }
    active.state = input.succeeded ? "action_accepted" : "researching";
    return { outcome: input.succeeded ? "accepted" as const : "retryable" as const };
  };

  const close = (sessionId: string, terminal: AgentSessionTerminal) => {
    if (active?.id !== sessionId) {
      return { outcome: "failed" as const, reason: "stale_session" as const };
    }
    active = null;
    continuationCount = 0;
    playerAttemptCount = 0;
    return { outcome: "closed" as const, terminal };
  };

  const recordContinuation = () => {
    if (!active) {
      return { outcome: "failed" as const, reason: "stale_session" as const };
    }
    if (active.state === "action_accepted") {
      active.state = "preparing_next";
      continuationCount = 1;
      return { outcome: "continued" as const, count: continuationCount };
    }
    if (active.state === "preparing_next") {
      const session = { ...active };
      active = null;
      continuationCount = 0;
      return {
        outcome: "failed" as const,
        reason: "agent_holding_loop" as const,
        count: 2,
        session,
      };
    }
    if (playerAttemptCount >= maxPlayerAttempts) {
      const session = { ...active };
      const count = continuationCount + 1;
      active = null;
      continuationCount = 0;
      playerAttemptCount = 0;
      return {
        outcome: "failed" as const,
        reason: "agent_holding_loop" as const,
        count,
        session,
      };
    }
    continuationCount += 1;
    if (continuationCount > maxContinuations) {
      const session = { ...active };
      active = null;
      return {
        outcome: "failed" as const,
        reason: "agent_holding_loop" as const,
        count: continuationCount,
        session,
      };
    }
    return { outcome: "continued" as const, count: continuationCount };
  };

  const enforceDeadline = () => {
    if (!active) {
      return { outcome: "failed" as const, reason: "stale_session" as const };
    }
    if (now() <= active.deadlineAtMs) {
      return { outcome: "within_deadline" as const };
    }
    const session = { ...active };
    active = null;
    continuationCount = 0;
    playerAttemptCount = 0;
    return {
      outcome: "failed" as const,
      reason: "agent_holding_loop" as const,
      session,
    };
  };

  const getActive = () => (active ? { ...active } : null);

  return {
    open,
    observeTransport,
    beginPlayerAction,
    resolvePlayerAction,
    close,
    recordContinuation,
    enforceDeadline,
    getActive,
  };
}

export type ContinuityIntentController = ReturnType<
  typeof createContinuityIntentController
>;
