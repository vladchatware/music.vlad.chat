import { fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { playerToolInputSchema } from "@/lib/dj";
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

export function createDJAgentTools(
  scheduleAnalysis: AnalysisScheduler = createViewerAnalysisScheduler(),
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

  return {
    dj_state: {
      description: "Read live decks, playback clock, analysis, transition, and recent history.",
      inputSchema: z.object({}).strict(),
    },
    track_analysis: {
      description: "Read one cached track analysis, including ranked entry/exit segments and local energy trajectory. No bulk lookup or analysis start.",
      inputSchema: z.object({
        id: z.number().int().positive(),
        aspect: z.enum(["summary", "timing", "structure", "energy", "full"]).default("summary"),
      }).strict(),
      execute: ({ id, aspect }) => readAnalysis(id, aspect),
    },
    schedule_track_analysis: {
      description: "Queue 1-8 promising SoundCloud candidate tracks for background analysis. Returns immediately; do not wait or repeatedly poll. Use results in later DJ turns via track_analysis.",
      inputSchema: z.object({
        ids: z.array(z.number().int().positive()).min(1).max(8),
      }).strict(),
      execute: async ({ ids }: { ids: number[] }) => {
        const uniqueIds = [...new Set(ids)];
        const result = await scheduleAnalysis(uniqueIds, 10);
        return result
          ? { status: "scheduled", trackIds: uniqueIds, ...result }
          : { status: "unavailable", trackIds: uniqueIds };
      },
    },
    player: {
      description: "Choose track and submit complete declarative DJ performance plan. Section anchors must exist in track_analysis. A release from a high-energy drop must exit at a proven falling segment, breakdown, or outro; do not use next_phrase unless analysis proves it reaches one.",
      inputSchema: playerToolInputSchema,
    },
  };
}
