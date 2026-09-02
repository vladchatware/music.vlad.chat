import { describe, expect, it } from "vitest";

import {
  classifyAgentSessionTerminal,
  computeAgentSessionDeadlineAtMs,
  computePlaybackAgentSessionDeadlineAtMs,
  createContinuityIntentController,
} from "./continuityIntent";

const openInput = {
  source: "planning_window" as const,
  activeTrackId: 101,
  deadlineAtMs: 60_000,
};

describe("createContinuityIntentController", () => {
  it("allows only one global agent session", () => {
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => 1_000,
    });

    expect(controller.open(openInput)).toMatchObject({
      outcome: "opened",
      session: { id: "intent-1", activeTrackId: 101 },
    });
    expect(controller.open({ ...openInput, source: "user" })).toMatchObject({
      outcome: "failed",
      reason: "agent_holding_loop",
      session: { id: "intent-1" },
    });
  });

  it("does not close session on intermediate transport ready", () => {
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => 1_000,
    });
    controller.open(openInput);

    controller.observeTransport("streaming");
    controller.observeTransport("ready");
    controller.observeTransport("submitted");

    expect(controller.getActive()).toMatchObject({
      id: "intent-1",
      state: "researching",
    });
    expect(controller.open(openInput)).toMatchObject({
      outcome: "failed",
      reason: "agent_holding_loop",
    });
  });

  it("treats a second player action as agent holding loop failure", () => {
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => 1_000,
    });
    controller.open(openInput);

    expect(
      controller.beginPlayerAction({ sessionId: "intent-1", activeTrackId: 101 }),
    ).toEqual({ outcome: "started" });
    controller.resolvePlayerAction({
      sessionId: "intent-1",
      activeTrackId: 101,
      succeeded: true,
    });

    expect(
      controller.beginPlayerAction({ sessionId: "intent-1", activeTrackId: 101 }),
    ).toEqual({ outcome: "failed", reason: "agent_holding_loop" });
  });

  it("rejects stale results from another active track", () => {
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => 1_000,
    });
    controller.open(openInput);

    expect(
      controller.beginPlayerAction({ sessionId: "intent-1", activeTrackId: 202 }),
    ).toEqual({ outcome: "failed", reason: "stale_session" });
  });

  it("accepts a versioned timeline action after playback advances tracks", () => {
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => 1_000,
    });
    controller.open(openInput);

    expect(controller.beginTimelineAction({ sessionId: "intent-1" })).toEqual({
      outcome: "started",
    });
    expect(controller.resolveTimelineAction({
      sessionId: "intent-1",
      succeeded: true,
    })).toEqual({ outcome: "accepted" });
  });

  it("permits a new session only after terminal close", () => {
    let id = 0;
    const controller = createContinuityIntentController({
      generateId: () => `intent-${++id}`,
      now: () => 1_000,
    });
    const first = controller.open(openInput);
    if (first.outcome !== "opened") throw new Error("expected opened session");

    expect(controller.close(first.session.id, "agent_holding_loop")).toEqual({
      outcome: "closed",
      terminal: "agent_holding_loop",
    });
    expect(controller.open(openInput)).toMatchObject({
      outcome: "opened",
      session: { id: "intent-2" },
    });
  });

  it("terminates a session that keeps requesting continuation rounds", () => {
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => 1_000,
      maxContinuations: 2,
    });
    controller.open(openInput);

    expect(controller.recordContinuation()).toEqual({ outcome: "continued", count: 1 });
    expect(controller.recordContinuation()).toEqual({ outcome: "continued", count: 2 });
    expect(controller.recordContinuation()).toMatchObject({
      outcome: "failed",
      reason: "agent_holding_loop",
      count: 3,
    });
    expect(controller.getActive()).toBeNull();
  });

  it("allows one bounded preparation turn after accepting the player action", () => {
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => 1_000,
    });
    controller.open(openInput);
    controller.beginPlayerAction({ sessionId: "intent-1", activeTrackId: 101 });
    controller.resolvePlayerAction({
      sessionId: "intent-1",
      activeTrackId: 101,
      succeeded: true,
    });

    expect(controller.recordContinuation()).toEqual({ outcome: "continued", count: 1 });
    expect(controller.getActive()).toMatchObject({ state: "preparing_next" });
  });

  it("does not erase post-player preparation when transport streams", () => {
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => 1_000,
    });
    controller.open(openInput);
    controller.beginPlayerAction({ sessionId: "intent-1", activeTrackId: 101 });
    controller.resolvePlayerAction({
      sessionId: "intent-1",
      activeTrackId: 101,
      succeeded: true,
    });
    controller.recordContinuation();

    controller.observeTransport("submitted");
    controller.observeTransport("streaming");

    expect(controller.getActive()).toMatchObject({
      state: "preparing_next",
    });
  });

  it("allows one rejected player retry, then terminates before a third model round", () => {
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => 1_000,
    });
    controller.open(openInput);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        controller.beginPlayerAction({
          sessionId: "intent-1",
          activeTrackId: 101,
        }),
      ).toEqual({ outcome: "started" });
      expect(
        controller.resolvePlayerAction({
          sessionId: "intent-1",
          activeTrackId: 101,
          succeeded: false,
        }),
      ).toEqual({ outcome: "retryable" });

      if (attempt === 0) {
        expect(controller.recordContinuation()).toEqual({
          outcome: "continued",
          count: 1,
        });
      }
    }

    expect(controller.recordContinuation()).toMatchObject({
      outcome: "failed",
      reason: "agent_holding_loop",
      count: 2,
    });
    expect(controller.getActive()).toBeNull();
  });

  it("terminates a session that exceeds its wall-clock deadline", () => {
    let nowMs = 1_000;
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => nowMs,
    });
    controller.open(openInput);
    nowMs = 60_001;

    expect(controller.enforceDeadline()).toMatchObject({
      outcome: "failed",
      reason: "agent_holding_loop",
    });
    expect(controller.getActive()).toBeNull();
  });

  it("rejects a player action that arrives after the live deadline", () => {
    let nowMs = 1_000;
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => nowMs,
    });
    controller.open(openInput);
    nowMs = 60_001;

    expect(controller.beginPlayerAction({ sessionId: "intent-1", activeTrackId: 101 })).toEqual({
      outcome: "failed",
      reason: "agent_holding_loop",
    });
    expect(controller.getActive()).toBeNull();
  });

  it("applies one wall-clock deadline through post-player preparation", () => {
    let nowMs = 1_000;
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => nowMs,
    });
    controller.open(openInput);
    controller.beginPlayerAction({ sessionId: "intent-1", activeTrackId: 101 });
    controller.resolvePlayerAction({
      sessionId: "intent-1",
      activeTrackId: 101,
      succeeded: true,
    });
    nowMs = 60_001;

    expect(controller.enforceDeadline()).toMatchObject({
      outcome: "failed",
      reason: "agent_holding_loop",
      session: {
        id: "intent-1",
        state: "action_accepted",
      },
    });
    expect(controller.getActive()).toBeNull();
  });

  it("fails a stalled same-session analysis continuation at the original deadline", () => {
    let nowMs = 1_000;
    const controller = createContinuityIntentController({
      generateId: () => "intent-1",
      now: () => nowMs,
    });
    controller.open(openInput);
    controller.beginPlayerAction({ sessionId: "intent-1", activeTrackId: 101 });
    controller.resolvePlayerAction({
      sessionId: "intent-1",
      activeTrackId: 101,
      succeeded: true,
    });
    controller.recordContinuation();
    nowMs = 60_001;

    expect(controller.enforceDeadline()).toMatchObject({
      outcome: "failed",
      reason: "agent_holding_loop",
      session: {
        id: "intent-1",
        state: "preparing_next",
      },
    });
    expect(controller.getActive()).toBeNull();
  });
});

describe("classifyAgentSessionTerminal", () => {
  it("treats an episode that finishes before player as holding-loop failure", () => {
    expect(classifyAgentSessionTerminal({
      outcome: "completed",
      state: "researching",
    })).toBe("agent_holding_loop");
  });

  it("waits for the same-session analysis continuation after player", () => {
    expect(classifyAgentSessionTerminal({
      outcome: "completed",
      state: "action_accepted",
    })).toBe("awaiting_continuation");
  });

  it("closes successfully only after post-player preparation", () => {
    expect(classifyAgentSessionTerminal({
      outcome: "completed",
      state: "preparing_next",
    })).toBe("planned");
  });
});

describe("computeAgentSessionDeadlineAtMs", () => {
  it("reserves ten seconds before natural track end", () => {
    expect(computeAgentSessionDeadlineAtMs({ nowMs: 1_000, remainingSec: 30 })).toBe(
      21_000,
    );
  });

  it("uses the real remaining-audio runway instead of the old seventy-second cap", () => {
    expect(computeAgentSessionDeadlineAtMs({ nowMs: 1_000, remainingSec: 120 })).toBe(
      111_000,
    );
  });

  it("gives manual recovery full runway when ended time has floating-point residue", () => {
    expect(
      computePlaybackAgentSessionDeadlineAtMs({
        nowMs: 1_000,
        remainingSec: 0.002,
      }),
    ).toBe(71_000);
  });

  it("does not give a preview stream an impossible sub-ten-second planning deadline", () => {
    expect(
      computePlaybackAgentSessionDeadlineAtMs({
        nowMs: 1_000,
        remainingSec: 17.8,
        durationSec: 29.78,
      }),
    ).toBe(71_000);
  });
});
