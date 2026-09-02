import { fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import {
  normalizePlayerToolInput,
  playerToolInputSchema,
  preparedPlayerSelectionSchema,
} from "@/lib/dj";
import { parseKey } from "@/lib/dj/harmonic/camelot";
import {
  formatTrackAnalysisForAgent,
  type TrackAnalysisAspect,
} from "@/lib/agentTrackAnalysis";
import {
  TRACK_ANALYSIS_VERSION,
  type TrackAnalysis,
} from "@/lib/trackAnalysis";
import { enqueueTrackAnalyses, type AnalysisEnqueueResult } from "./analysisQueue";

type AnalysisLoader = (trackId: string) => Promise<TrackAnalysis | null>;
type AnalysisScheduler = (
  trackIds: number[],
  priority?: number,
) => Promise<AnalysisEnqueueResult | null>;
type ViewerAuth = {
  token?: string;
  user?: { isAnonymous?: boolean; soundcloudAccessToken?: string } | null;
};

async function loadCurrentViewerAuth(): Promise<ViewerAuth> {
  const { convexAuthNextjsToken } = await import("@convex-dev/auth/nextjs/server");
  const token = await convexAuthNextjsToken();
  if (!token) return {};
  const user = await fetchQuery(api.users.viewer, {}, { token });
  return { token, user };
}

export function createViewerAnalysisScheduler(
  loadViewer: () => Promise<ViewerAuth> = loadCurrentViewerAuth,
  enqueue: typeof enqueueTrackAnalyses = enqueueTrackAnalyses,
): AnalysisScheduler {
  return async (trackIds, priority = 0) => {
    let token: string | undefined;
    try {
      const viewer = await loadViewer();
      if (viewer.token && viewer.user && !viewer.user.isAnonymous && viewer.user.soundcloudAccessToken) {
        token = viewer.token;
      }
    } catch {
      // Public/anonymous requests continue through service-authenticated queue.
    }
    return enqueue(trackIds, priority, token);
  };
}

export function createTrackAnalysisReader(load: AnalysisLoader) {
  const cache = new Map<string, Promise<TrackAnalysis | null>>();

  return async (id: number, aspect: TrackAnalysisAspect) => {
    const trackId = String(id);
    const pending = cache.get(trackId) ?? load(trackId);
    cache.set(trackId, pending);

    try {
      const analysis = await pending;
      return analysis
        ? { status: "ready", analysis: formatTrackAnalysisForAgent(analysis, aspect) }
        : { status: "not_ready", trackId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: /429|rate.?limit/i.test(message) ? "rate_limited" : "unavailable", trackId };
    }
  };
}

export function limitForegroundAnalysis<T>(
  read: (id: number, aspect: TrackAnalysisAspect) => Promise<T>,
  maxReads = 3,
) {
  let reads = 0;
  return (id: number, aspect: TrackAnalysisAspect) => {
    if (reads >= maxReads) {
      return Promise.resolve({
        status: "foreground_budget_exhausted" as const,
        trackId: String(id),
        instruction: "Choose from the analyses already returned and call player now.",
      });
    }
    reads += 1;
    return read(id, aspect);
  };
}

export function createBatchAnalysisReader<T>(
  read: (id: number, aspect: TrackAnalysisAspect) => Promise<T>,
) {
  return async (ids: number[], aspect: TrackAnalysisAspect) => {
    const uniqueIds = [...new Set(ids)];
    const evidence = await Promise.all(
      uniqueIds.map(async (id) => ({ id, result: await read(id, aspect) })),
    );
    return { evidence };
  };
}

export function createBoundedAnalysisSchedule(
  scheduleAnalysis: AnalysisScheduler,
) {
  let acceptedTrackIds: number[] | null = null;
  return async (trackIds: number[], priority = 10) => {
    const uniqueIds = [...new Set(trackIds)];
    if (acceptedTrackIds) {
      return {
        status: "already_scheduled" as const,
        trackIds: acceptedTrackIds,
      };
    }
    acceptedTrackIds = uniqueIds;
    const result = await scheduleAnalysis(uniqueIds, priority);
    return result
      ? { status: "scheduled" as const, trackIds: uniqueIds, ...result }
      : { status: "unavailable" as const, trackIds: uniqueIds };
  };
}

export function createDJAgentTools(
  scheduleAnalysis: AnalysisScheduler = createViewerAnalysisScheduler(),
  opts: {
    maxForegroundAnalyses?: number;
    playerCandidateIds?: number[];
    compactPlayerSelection?: boolean;
  } = {},
) {
  const readAnalysis = createTrackAnalysisReader(async (trackId) => {
    const analysis = await fetchQuery(api.trackAnalysis.getBySoundCloudId, {
      trackId,
      analysisVersion: TRACK_ANALYSIS_VERSION,
    });
    if (!analysis) return null;
    return {
      ...analysis,
      segments: analysis.segments ?? [],
      tonal: {
        ...analysis.tonal,
        camelotKey: analysis.tonal.camelotKey
          ? parseKey(analysis.tonal.camelotKey) ?? undefined
          : undefined,
      },
    };
  });
  const readForegroundAnalysis = limitForegroundAnalysis(
    readAnalysis,
    opts.maxForegroundAnalyses ?? 3,
  );
  const scheduleOnce = createBoundedAnalysisSchedule(scheduleAnalysis);
  const readBatchAnalysis = createBatchAnalysisReader(readForegroundAnalysis);
  const playerCandidateIds = [...new Set(
    (opts.playerCandidateIds ?? []).filter(
      (id) => Number.isInteger(id) && id > 0,
    ),
  )].slice(0, 32);
  const playerIdSchema = playerCandidateIds.length === 0
    ? z.number().int().positive()
    : playerCandidateIds.length === 1
      ? z.literal(playerCandidateIds[0]!)
      : z.union(
          playerCandidateIds.map((id) => z.literal(id)) as [
            z.ZodLiteral<number>,
            z.ZodLiteral<number>,
            ...z.ZodLiteral<number>[],
          ],
        );
  const boundedPlayerInputSchema = z.preprocess(
    normalizePlayerToolInput,
    playerToolInputSchema
      .extend({
        id: playerIdSchema,
      })
      .superRefine((value, context) => {
        if (/\btest(?:ing)?\b|\bviability\b/i.test(value.performance.reason)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["performance", "reason"],
            message: "Describe the intended heard musical move; testing placeholders are not a performance plan.",
          });
        }
      }),
  );
  const candidateInstruction = playerCandidateIds.length > 0
    ? ` Valid discovered candidate IDs: ${playerCandidateIds.join(", ")}. The id must be one of these exact values.`
    : "";
  const compactPlayerInputSchema = preparedPlayerSelectionSchema.extend({
    id: playerIdSchema,
  }).strip();
  const uniqueTimelineTracks = (
    value: { tracks: Array<{ id: number }> },
    context: z.RefinementCtx,
  ) => {
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
  };
  const boundedTimelineInputSchema = z.object({
    baseRevision: z.number().int().nonnegative(),
    tracks: z.array(boundedPlayerInputSchema).min(1).max(3),
  }).strict().superRefine(uniqueTimelineTracks);
  const compactTimelineInputSchema = z.object({
    baseRevision: z.number().int().nonnegative(),
    tracks: z.array(compactPlayerInputSchema).min(1).max(3),
  }).strict().superRefine(uniqueTimelineTracks);

  return {
    dj_state: {
      description: "Read live decks, playback clock, analysis, transition, and recent history.",
      inputSchema: z.object({}).strict(),
    },
    track_analysis: {
      description: "Read one cached track analysis for a candidate, including ranked entry/exit segments and local energy trajectory. May return not_ready; never poll or start analysis from this tool. Use metadata plus safe anchors when evidence is unavailable.",
      inputSchema: z.object({
        id: z.number().int().positive(),
        aspect: z.enum(["summary", "timing", "structure", "energy", "full"]).default("summary"),
      }).strict(),
      execute: ({ id, aspect }) => readForegroundAnalysis(id, aspect),
    },
    compare_track_analysis: {
      description: "Compare 2-3 cached candidate analyses in one call. Returns aligned ready/not_ready evidence without choosing a winner. Use once for a prepared candidate pool when comparison can change the musical choice; never poll.",
      inputSchema: z.object({
        ids: z.array(z.number().int().positive()).min(2).max(3),
        aspect: z.enum(["summary", "timing", "structure", "energy", "full"]).default("summary"),
      }).strict(),
      execute: ({ ids, aspect }: { ids: number[]; aspect: TrackAnalysisAspect }) =>
        readBatchAnalysis(ids, aspect),
    },
    schedule_track_analysis: {
      description: "Queue 1-8 strongest candidates returned by tracks search for background analysis, even when another liked track is already analyzed. Cached IDs are deduplicated. Call once before player, return immediately, and never wait or poll. Use results in later DJ turns via track_analysis.",
      inputSchema: z.object({
        ids: z.array(z.number().int().positive()).min(1).max(8),
      }).strict(),
      execute: async ({ ids }: { ids: number[] }) => {
        return scheduleOnce(ids, 10);
      },
    },
    player: {
      description: opts.compactPlayerSelection
        ? `Replace the editable DJ setQueue suffix with 1-3 prepared tracks in play order. Copy setQueue.revision into baseRevision. Prefer 2-3 tracks when musicPool permits. State each musical energy arc and brief heard reason; runtime supplies safe mechanics.${candidateInstruction}`
        : `Replace the editable DJ setQueue suffix with 1-3 discovered unplayed tracks in play order. Copy setQueue.revision into baseRevision. Prefer 2-3 tracks so player can consume the head while you later rebuild the suffix. Submit a complete declarative performance plan for every track. Inspect useful candidates with track_analysis first when available; if evidence is not ready, use mix_out and mix_in instead of invented cues. Section anchors must exist in returned analysis. A release from a high-energy drop must exit at a proven falling segment, breakdown, or outro; do not use next_phrase unless analysis proves it reaches one. Low ambient into a rising high-energy segment is a build, not a reset. Do not use reset or cut as a fallback for an incompatible candidate. For tracks under 3 minutes, keep entry within the first 32 seconds; after an abrupt or deep-entry outcome, keep it within 24 seconds. Placeholder testing/viability reasons are rejected.${candidateInstruction}`,
      inputSchema: opts.compactPlayerSelection
        ? compactTimelineInputSchema
        : boundedTimelineInputSchema,
    },
  };
}
