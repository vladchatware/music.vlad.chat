import { resolveTrackStreamUrl, track } from "../../soundcloud";
import { TRACK_ANALYSIS_VERSION, type TrackAnalysis } from "../../lib/trackAnalysis";
import type { AnalysisJob } from "./api";
import { analyzePcm } from "./analyze";
import { decodeUrlToMonoPcm } from "./decode";
import { MAX_TRACK_DURATION_SEC } from "./config";
import { enrichSegmentsWithSemantics } from "./semantic";
import {
  analyzeSemanticWindows,
  SEMANTIC_HOP_SEC,
  SEMANTIC_SAMPLE_RATE,
  SEMANTIC_WINDOW_SEC,
  type SemanticPredictor,
} from "./semanticInference";
import { getSemanticPredictor } from "./semanticModels";
import { SEMANTIC_MODELS } from "./modelCatalog";

type ProcessDependencies = {
  semanticPredictor?: SemanticPredictor;
  soundCloudAccessToken?: string;
};

function isNonStreamableError(error: unknown): boolean {
  const err = error as { nonStreamable?: boolean; status?: number; message?: string } | null;
  return err?.nonStreamable === true
    || err?.status === 404
    || err?.status === 410
    || (typeof err?.message === 'string' && err.message.includes('No full stream URL'));
}

export async function processAnalysisJob(
  job: AnalysisJob,
  dependencies: ProcessDependencies = {},
): Promise<TrackAnalysis> {
  const startedAt = Date.now();
  let metadata: Awaited<ReturnType<typeof track>>;
  try {
    metadata = await track(job.sourceTrackId, dependencies.soundCloudAccessToken);
  } catch (error) {
    if (isNonStreamableError(error)) {
      throw new Error(`[NON_STREAMABLE] ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
  if (!metadata?.streamable) throw new Error("[NON_STREAMABLE] SoundCloud track is not streamable");
  const durationSec = Number(metadata.duration) / 1000;
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("Invalid track duration");
  if (durationSec > MAX_TRACK_DURATION_SEC) throw new Error("Track exceeds 10 minute analysis limit");

  let streamUrl: string;
  try {
    streamUrl = await resolveTrackStreamUrl(
      job.sourceTrackId,
      dependencies.soundCloudAccessToken,
      15_000,
      false,
    );
  } catch (error) {
    if (isNonStreamableError(error)) {
      throw new Error(`[NON_STREAMABLE] ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
  const signal = await decodeUrlToMonoPcm(streamUrl, dependencies.soundCloudAccessToken);
  const decodedDurationSec = signal.length / 22_050;
  if (decodedDurationSec > MAX_TRACK_DURATION_SEC + 1) {
    throw new Error("Decoded audio exceeds 10 minute analysis limit");
  }
  // A preview decode is ~30s regardless of track length — treat a decode that
  // misses most of the track as a stream-resolution failure, not an analysis.
  if (decodedDurationSec < durationSec * 0.9) {
    throw new Error(
      `[PREVIEW_DECODE] Decoded ${decodedDurationSec.toFixed(1)}s of a ${durationSec.toFixed(0)}s track — stream URL was a preview`,
    );
  }
  const analysis = analyzePcm(signal, job.sourceTrackId, job.analysisVersion, startedAt);
  if (job.analysisVersion !== TRACK_ANALYSIS_VERSION) return analysis;

  try {
    const predictor = dependencies.semanticPredictor ?? await getSemanticPredictor();
    const windows = await analyzeSemanticWindows(signal, predictor);
    return {
      ...analysis,
      processingTimeMs: Date.now() - startedAt,
      segments: enrichSegmentsWithSemantics(analysis.segments, windows),
      semantic: {
        status: "ready",
        models: SEMANTIC_MODELS.map((model) => model.id),
        sampleRate: SEMANTIC_SAMPLE_RATE,
        windowSec: SEMANTIC_WINDOW_SEC,
        hopSec: SEMANTIC_HOP_SEC,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...analysis,
      processingTimeMs: Date.now() - startedAt,
      warnings: [...analysis.warnings, `semantic inference unavailable: ${message}`],
      semantic: {
        status: "unavailable",
        models: SEMANTIC_MODELS.map((model) => model.id),
        sampleRate: SEMANTIC_SAMPLE_RATE,
        windowSec: SEMANTIC_WINDOW_SEC,
        hopSec: SEMANTIC_HOP_SEC,
      },
    };
  }
}
