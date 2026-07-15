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
        crossfaderCurve: z.enum(["equal_power", "linear", "cut"]),
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

export type PerformanceSection = z.infer<typeof sectionSchema>;
export type DJPerformancePlan = z.infer<typeof djPerformancePlanSchema>;
export type PlayerToolInput = z.infer<typeof playerToolInputSchema>;
