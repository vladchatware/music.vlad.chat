import { z } from "zod";

import type { DJTimelinePatch, PlayerToolInput } from "./schema";

export const preparedPlayerSelectionSchema = z.object({
  id: z.number().int().positive(),
  energyArc: z.enum(["preserve", "build", "release", "reset"]),
  reason: z.string().min(1).max(240),
}).strip();

export type PreparedPlayerSelection = z.infer<typeof preparedPlayerSelectionSchema>;

export const preparedTimelinePatchSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  tracks: z.array(preparedPlayerSelectionSchema).min(1).max(3),
}).strip().superRefine((value, context) => {
  const seen = new Set<number>();
  value.tracks.forEach((track, index) => {
    if (seen.has(track.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tracks", index, "id"],
        message: "Timeline cannot contain the same track twice.",
      });
    }
    seen.add(track.id);
  });
});

export type PreparedTimelinePatch = z.infer<typeof preparedTimelinePatchSchema>;

export function hydratePreparedPlayerSelection(
  selection: PreparedPlayerSelection,
): PlayerToolInput {
  const intentionalReset = selection.energyArc === "reset";
  return {
    id: selection.id,
    performance: {
      energyArc: selection.energyArc,
      exit: { anchor: "next_phrase" },
      entry: { anchor: intentionalReset ? "first_downbeat" : "mix_in" },
      blend: {
        duration: { bars: 8 },
        crossfaderCurve: "equal_power",
        eq: "bass_swap",
      },
      tempo: { mode: "preserve" },
      reason: selection.reason,
    },
  };
}

export function resolvePreparedPlayerSelection(
  value: unknown,
  candidateTrackIds: readonly number[],
): PlayerToolInput | null {
  const parsed = preparedPlayerSelectionSchema.safeParse(value);
  if (!parsed.success || !candidateTrackIds.includes(parsed.data.id)) return null;
  return hydratePreparedPlayerSelection(parsed.data);
}

export function hydratePreparedTimelinePatch(
  patch: PreparedTimelinePatch,
): DJTimelinePatch {
  return {
    baseRevision: patch.baseRevision,
    tracks: patch.tracks.map(hydratePreparedPlayerSelection),
  };
}

export function resolvePreparedTimelinePatch(
  value: unknown,
  candidateTrackIds: readonly number[],
): DJTimelinePatch | null {
  const parsed = preparedTimelinePatchSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.tracks.some((track) => !candidateTrackIds.includes(track.id))) {
    return null;
  }
  return hydratePreparedTimelinePatch(parsed.data);
}
