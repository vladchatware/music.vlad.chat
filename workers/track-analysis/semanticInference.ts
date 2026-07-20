import { ANALYSIS_SAMPLE_RATE } from "./config";
import type { SemanticWindow } from "./semantic";

export const SEMANTIC_SAMPLE_RATE = 16_000;
export const SEMANTIC_WINDOW_SEC = 10;
export const SEMANTIC_HOP_SEC = 5;

export type SemanticPrediction = Omit<SemanticWindow, "startSec" | "endSec">;
export type SemanticPredictor = (audio16k: Float32Array) => Promise<SemanticPrediction>;

const probability = (value: number) =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function resampleLinear(
  input: Float32Array,
  sourceRate = ANALYSIS_SAMPLE_RATE,
  targetRate = SEMANTIC_SAMPLE_RATE,
): Float32Array {
  if (sourceRate === targetRate) return input;
  const output = new Float32Array(Math.round(input.length * targetRate / sourceRate));
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = (input[left] ?? 0) * (1 - fraction) + (input[right] ?? 0) * fraction;
  }
  return output;
}

export async function analyzeSemanticWindows(
  signal: Float32Array,
  predict: SemanticPredictor,
): Promise<SemanticWindow[]> {
  const durationSec = signal.length / ANALYSIS_SAMPLE_RATE;
  const windows: SemanticWindow[] = [];
  for (let startSec = 0; startSec < durationSec; startSec += SEMANTIC_HOP_SEC) {
    if (startSec > 0 && durationSec - startSec < SEMANTIC_HOP_SEC) break;
    const endSec = Math.min(durationSec, startSec + SEMANTIC_WINDOW_SEC);
    const source = signal.slice(
      Math.floor(startSec * ANALYSIS_SAMPLE_RATE),
      Math.floor(endSec * ANALYSIS_SAMPLE_RATE),
    );
    const prediction = await predict(resampleLinear(source));
    windows.push({
      startSec,
      endSec,
      vocalProbability: probability(prediction.vocalProbability),
      ...Object.fromEntries(
        (["danceability", "approachability", "engagement"] as const)
          .filter((field) => prediction[field] !== undefined)
          .map((field) => [field, probability(prediction[field] ?? 0)]),
      ),
      ...(prediction.valence === undefined ? {} : { valence: prediction.valence }),
      ...(prediction.arousal === undefined ? {} : { arousal: prediction.arousal }),
      ...Object.fromEntries(
        (["mirexMood", "themes", "instruments", "genres", "timbre"] as const)
          .filter((field) => prediction[field] !== undefined)
          .map((field) => [field, Object.fromEntries(Object.entries(prediction[field] ?? {})
            .map(([label, value]) => [label, probability(value)]))]),
      ),
    });
  }
  return windows;
}
