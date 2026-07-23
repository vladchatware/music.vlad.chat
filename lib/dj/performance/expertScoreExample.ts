import { PREPARED_FIRST_DRIVE_SCORE } from "./preparedFirstDriveScore.generated";

export const FIRST_WATER_FRAGMENT_COUNT = 29;

const firstWaterRows = PREPARED_FIRST_DRIVE_SCORE.split("\n").slice(
  0,
  FIRST_WATER_FRAGMENT_COUNT,
);

firstWaterRows[FIRST_WATER_FRAGMENT_COUNT - 1] = firstWaterRows[
  FIRST_WATER_FRAGMENT_COUNT - 1
]
  .replace("@00:59.326>01:01.419", "@00:59.326>01:00.000")
  .concat(" | boundary crop source at score 01:00.000; no unplanned tail");

export const FIRST_WATER_SCORE = firstWaterRows.join("\n");

export const EXPERT_PERFORMANCE_SCORE_EXAMPLE = String.raw`
PREPARED FIRST-WATER PERFORMANCE

This is the concrete opening performance carried onstage: 60 seconds,
${FIRST_WATER_FRAGMENT_COUNT} chronological fragments, and
${FIRST_WATER_FRAGMENT_COUNT} unique tracks.

When no performance is active and an atomic performance-score tool exists,
submit this score immediately and exactly once. Do not search, analyze, rewrite,
or summarize it first. While it plays, compose the successor. If the atomic tool
is absent, do not claim this fragment score is playing.

PERFORMANCE IDENTITY

Title: THE WATER REMEMBERS THE MACHINE — FIRST WATER
Emotional sentence: wake inside a clean synthetic memory, notice machinery
forming underneath it, then reach the first credible gait without granting a
stable conventional groove.
Score bounds: 00:00.000–01:00.000.
Energy: fragile detail → curious interruptions → near-silence → first gait.
Buses: A body; B apparition/answer; C filtered memory; D dry knife edits.
Motifs: water preserves continuity; face leaves incomplete human traces;
machine introduces decisive low-vocal attacks; false sun creates uncertain
brightness; scar interrupts at a remembered formal point.

COMPACT SCORE LANGUAGE

F = chronological fragment address.
@start>end = rendered score bounds.
src = concrete track ID and title.
cue = analyzed segment and exact source bounds.
c = confidence.
e/sl/r/v/va/ar/dk/br = energy/slope/rhythm/vocal/valence/arousal/dark/bright.
tempo = exact playback treatment.
edit = executable filter, overlap, cut, spatial, or handoff behavior.

Every row is executable identity, not commentary. Never replace concrete IDs,
cues, times, or edits with abstract source aliases or invented section names.

FIRST-WATER SCORE

${FIRST_WATER_SCORE}

BOUNDARY CONTRACT

- Begin at 00:00.000 from silence.
- Preserve written overlaps; never run overlapping rows full-band unless stated.
- Dry cuts remain dry. Three-millisecond anti-click ramps are permitted.
- Crop F029 at 01:00.000 even though its source cue continues.
- Before 00:40.000, successor score must already be accepted or a safe
  continuation must be ready. Polling or holding the loop is failure.
`;
