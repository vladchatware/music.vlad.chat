import { z } from "zod";

import type { PlayerToolInput } from "./schema";

export const preparedPlayerSelectionSchema = z.object({
  id: z.number().int().positive(),
  energyArc: z.enum(["preserve", "build", "release", "reset"]),
  reason: z.string().min(1).max(240),
}).strict();

export type PreparedPlayerSelection = z.infer<typeof preparedPlayerSelectionSchema>;

export function hydratePreparedPlayerSelection(
  selection: PreparedPlayerSelection,
): PlayerToolInput {
  return {
    id: selection.id,
    performance: {
      energyArc: selection.energyArc,
      exit: { anchor: "next_phrase" },
      entry: { anchor: "mix_in" },
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
