import { describe, expect, it } from "vitest";

import { getDJLiveStateInstruction } from "./djLiveState";

describe("getDJLiveStateInstruction", () => {
  it("keeps live state out of the user prompt while making it available to the agent", () => {
    const instruction = getDJLiveStateInstruction({
      activeTrack: { id: 10 },
      currentTimeSec: 4,
      performanceMemory: { candidateTrackIds: [20, 30] },
      lastTransitionOutcome: {
        outgoingTrackId: 1,
        incomingTrackId: 10,
        handoffEnergyMismatch: 0.24,
        executedEnergyArc: "build",
        incomingEnergyRise: 0.51,
        transitionOutcome: "completed",
      },
    });

    expect(instruction).toContain("CURRENT LIVE DJ STATE");
    expect(instruction).toContain('"currentTimeSec":4');
    expect(instruction).toContain('"candidateTrackIds":[20,30]');
    expect(instruction).toContain('"handoffEnergyMismatch":0.24');
    expect(instruction).toContain('"executedEnergyArc":"build"');
    expect(instruction).toContain('"incomingEnergyRise":0.51');
    expect(instruction).toContain("call dj_state only to refresh after a rejected action");
  });

  it("ignores absent or empty snapshots", () => {
    expect(getDJLiveStateInstruction(null)).toBeNull();
    expect(getDJLiveStateInstruction({})).toBeNull();
  });
});
