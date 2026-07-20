import { describe, expect, it } from "vitest";

import {
  crowdPlacement,
  getBeatPulse,
  getDancerJumpAmplitude,
  getPlaybackBeatSnapshot,
  nextDancerY,
  nextSimulatorUsername,
  updateBeatAmplitude,
} from "./dancerMotion";

describe("crowdPlacement", () => {
  it("keeps later rows distinct from the first row and below player controls", () => {
    const placements = Array.from({ length: 10 }, (_, index) => crowdPlacement(index, 0));
    const coordinates = placements.map(({ x, z }) => `${x}:${z}`);

    expect(new Set(coordinates).size).toBe(placements.length);
    expect(placements[5].x).not.toBe(placements[0].x);
    expect(placements.every(({ y }) => y <= -3.2)).toBe(true);
  });
});

describe("getBeatPulse", () => {
  it("peaks on the detected beat and decays through the beat phase", () => {
    const onBeat = getBeatPulse({ phase: 0, strength: 0.8, tracked: true });
    const betweenBeats = getBeatPulse({ phase: 0.5, strength: 0.8, tracked: true });

    expect(onBeat).toBeGreaterThan(0.9);
    expect(betweenBeats).toBeLessThan(0.2);
  });

  it("falls back to live bass energy before beat tracking locks", () => {
    expect(getBeatPulse({ phase: 0, strength: 0.8, tracked: false })).toBeGreaterThan(0.5);
  });

  it("holds enough of the jump to make its amplitude visible", () => {
    const quarterBeat = getBeatPulse({ phase: 0.25, strength: 1, tracked: true });

    expect(quarterBeat).toBeGreaterThan(0.3);
  });

  it("does not force a jump on low-energy beats", () => {
    const quietBeat = getBeatPulse({ phase: 0, strength: 0.1, tracked: true });

    expect(quietBeat).toBeLessThan(0.05);
  });
});

describe("getPlaybackBeatSnapshot", () => {
  it("uses explicit track beat markers instead of detector phase", () => {
    const snapshot = getPlaybackBeatSnapshot({
      beatGrid: {
        bpm: 120,
        beatsPerBar: 4,
        firstDownbeat: 0,
        confidence: 1,
        beats: [0, 0.5, 1],
      },
      currentTimeSec: 0.25,
      strength: 0.8,
      fallbackPhase: 0.9,
      fallbackTracked: true,
    });

    expect(snapshot).toEqual({ phase: 0.5, strength: 0.8, tracked: true });
  });
});

describe("nextDancerY", () => {
  it("applies beat attack immediately", () => {
    expect(nextDancerY(-3.5, -3, 1 / 60)).toBe(-3);
  });

  it("smooths the fall after the beat", () => {
    const next = nextDancerY(-3, -3.5, 1 / 60);
    expect(next).toBeLessThan(-3);
    expect(next).toBeGreaterThan(-3.5);
  });
});

describe("updateBeatAmplitude", () => {
  it("normalizes bass against an adaptive local range", () => {
    const result = updateBeatAmplitude({ floor: 0.7, ceiling: 0.9 }, 0.75);

    expect(result.strength).toBeGreaterThan(0.2);
    expect(result.strength).toBeLessThan(0.35);
  });
});

describe("getDancerJumpAmplitude", () => {
  it("makes strong beats visibly larger than quiet beats", () => {
    const quiet = getDancerJumpAmplitude(0.2, false, 1);
    const strong = getDancerJumpAmplitude(0.9, false, 1);

    expect(strong).toBeGreaterThan(1.1);
    expect(strong).toBeGreaterThan(quiet * 2);
  });
});

describe("nextSimulatorUsername", () => {
  it("increments a trailing number so repeated simulation creates another person", () => {
    expect(nextSimulatorUsername("tiny_dancer")).toBe("tiny_dancer2");
    expect(nextSimulatorUsername("tiny_dancer9")).toBe("tiny_dancer10");
  });
});
