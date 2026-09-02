import { z } from "zod";

const sectionSchema = z.enum([
  "intro",
  "verse",
  "buildup",
  "drop",
  "breakdown",
  "outro",
]);

const exitSchema = z.discriminatedUnion("anchor", [
  z.object({ anchor: z.literal("next_phrase"), notBeforeSec: z.number().nonnegative().optional() }).strict(),
  z.object({ anchor: z.literal("mix_out"), notBeforeSec: z.number().nonnegative().optional() }).strict(),
  z.object({ anchor: z.literal("section"), section: sectionSchema, notBeforeSec: z.number().nonnegative().optional() }).strict(),
  z.object({ anchor: z.literal("time"), timeSec: z.number().nonnegative(), notBeforeSec: z.number().nonnegative().optional() }).strict(),
]);

const entrySchema = z.discriminatedUnion("anchor", [
  z.object({ anchor: z.literal("mix_in") }).strict(),
  z.object({ anchor: z.literal("first_downbeat") }).strict(),
  z.object({ anchor: z.literal("section"), section: sectionSchema }).strict(),
  z.object({ anchor: z.literal("time"), timeSec: z.number().nonnegative() }).strict(),
]);

const durationSchema = z.union([
  z.object({ bars: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16)]) }).strict(),
  z.object({ seconds: z.number().positive().max(120) }).strict(),
]);

export const djPerformancePlanSchema = z
  .object({
    energyArc: z.enum(["preserve", "build", "release", "reset"]),
    exit: exitSchema,
    entry: entrySchema,
    blend: z
      .object({
        duration: durationSchema,
        crossfaderCurve: z
          .enum(["equal_power", "linear", "cut", "smooth"])
          .transform((curve) => curve === "smooth" ? "equal_power" as const : curve),
        eq: z.enum(["bass_swap", "frequency_split", "smooth", "high_first"]),
        bassSwapAt: z.number().optional(),
      })
      .strict(),
    tempo: z
      .object({
        mode: z.enum(["match", "preserve"]),
        maxAdjustmentPercent: z.number().nonnegative().max(8).optional(),
      })
      .strict(),
    loop: z
      .object({
        deck: z.enum(["outgoing", "incoming"]),
        bars: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]),
        repetitions: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      })
      .strict()
      .optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const playerToolInputSchema = z
  .object({
    id: z.number().int().positive(),
    performance: djPerformancePlanSchema,
  })
  .strict();

/** Repair one common model serialization slip without weakening the runtime
 * contract: tempo belongs inside performance, but models occasionally emit it
 * beside performance after producing several timeline items. */
export function normalizePlayerToolInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const performance = record.performance;
  if (
    !performance ||
    typeof performance !== "object" ||
    Array.isArray(performance) ||
    "tempo" in (performance as Record<string, unknown>) ||
    !("tempo" in record)
  ) {
    return value;
  }
  const { tempo, ...track } = record;
  return {
    ...track,
    performance: {
      ...(performance as Record<string, unknown>),
      tempo,
    },
  };
}

export function normalizeDJTimelinePatchInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tracks)) return value;
  return {
    ...record,
    tracks: record.tracks.map(normalizePlayerToolInput),
  };
}

/**
 * Versioned replacement for the agent-owned, uncommitted timeline suffix.
 * Player keeps any already committed transition and consumes these tracks in
 * order. One agent call can therefore author several records ahead without
 * gaining control of the playback clock.
 */
const canonicalDJTimelinePatchSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    tracks: z.array(playerToolInputSchema).min(1).max(3),
  })
  .strict()
  .superRefine((value, context) => {
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

export const djTimelinePatchSchema = z.preprocess(
  normalizeDJTimelinePatchInput,
  canonicalDJTimelinePatchSchema,
);

export type PerformanceSection = z.infer<typeof sectionSchema>;
export type DJPerformancePlan = z.infer<typeof djPerformancePlanSchema>;
export type PlayerToolInput = z.infer<typeof playerToolInputSchema>;
export type DJTimelinePatch = z.infer<typeof djTimelinePatchSchema>;
