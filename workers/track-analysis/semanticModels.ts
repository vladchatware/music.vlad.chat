import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as tf from "@tensorflow/tfjs-node";
import { EssentiaModel, EssentiaWASM } from "essentia.js";
import * as ort from "onnxruntime-node";

import { EFFNET_HEADS, MUSICNN_HEADS } from "./modelCatalog";
import { createLocalModelIOHandler } from "./modelArtifacts";
import type { SemanticPredictor } from "./semanticInference";

type MusicNnFeatures = {
  melSpectrum: number[][];
  patchSize: number;
  frameSize: number;
  melBandsSize: number;
};
type InputExtractor = { computeFrameWise(audio: Float32Array, hopSize?: number): MusicNnFeatures };
type MusicNnModel = { initialize(): Promise<void>; predict(input: unknown, zeroPadding?: boolean): Promise<unknown[]> };

export function probabilityForClass(output: unknown[], classIndex: number): number {
  const rows = output.filter(Array.isArray) as unknown[][];
  const values = rows.map((row) => Number(row[classIndex])).filter(Number.isFinite);
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

export function hasAudibleSignal(audio: Float32Array): boolean {
  for (const sample of audio) if (Math.abs(sample) > 1e-5) return true;
  return false;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const meanColumn = (rows: number[][], column: number) =>
  rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + (row[column] ?? 0), 0) / rows.length;

export function topLabelScores(values: Record<string, number>, limit = 6, minimum = 0.05) {
  return Object.fromEntries(Object.entries(values)
    .filter(([, score]) => score >= minimum)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit));
}

export function mirexMoodScores(rows: number[][], labels: readonly string[]) {
  return Object.fromEntries(labels.map((label, index) => [
    label,
    clamp(Number(meanColumn(rows, index).toFixed(6))),
  ]));
}

export function createEffnetPatches(features: MusicNnFeatures): { data: Float32Array; count: number } {
  const patchSize = 128;
  const patchHopSize = 62;
  const starts: number[] = [];
  for (let start = 0; start + patchSize <= features.frameSize; start += patchHopSize) starts.push(start);
  const data = new Float32Array(starts.length * patchSize * features.melBandsSize);
  let offset = 0;
  for (const start of starts) {
    for (let frame = start; frame < start + patchSize; frame += 1) {
      data.set(features.melSpectrum[frame] ?? [], offset);
      offset += features.melBandsSize;
    }
  }
  return { data, count: starts.length };
}

function defaultModelRoot() {
  return process.env.ESSENTIA_MODEL_DIR || join(process.cwd(), "workers/track-analysis/models");
}

async function loadGraph(root: string, name: string) {
  const modelPath = join(root, name, "model.json");
  await access(modelPath);
  return tf.loadGraphModel(createLocalModelIOHandler(modelPath));
}

async function loadLabels(root: string, name: string): Promise<string[]> {
  const metadata = JSON.parse(await readFile(join(root, name, "metadata.json"), "utf8")) as { classes?: string[] };
  return metadata.classes ?? [];
}

async function loadVoiceModel(root: string): Promise<MusicNnModel> {
  const modelPath = join(root, "voice_instrumental", "model.json");
  await access(modelPath);
  const model = new EssentiaModel.TensorflowMusiCNN(
    tf,
    createLocalModelIOHandler(modelPath) as never,
  ) as MusicNnModel;
  await model.initialize();
  return model;
}

function batchFeatures(features: MusicNnFeatures): tf.Tensor3D {
  const batches = Math.max(1, Math.ceil(features.frameSize / features.patchSize));
  return tf.tidy(() => {
    const source = tf.tensor2d(features.melSpectrum, [features.frameSize, features.melBandsSize]);
    const missingRows = batches * features.patchSize - features.frameSize;
    const padded = missingRows > 0
      ? tf.concat([source, tf.zeros([missingRows, features.melBandsSize])])
      : source;
    return padded.reshape([batches, features.patchSize, features.melBandsSize]) as tf.Tensor3D;
  });
}

async function rowsFrom(model: tf.GraphModel, input: tf.Tensor, output?: string): Promise<number[][]> {
  const result = model.execute(input, output) as tf.Tensor;
  try {
    return await result.array() as number[][];
  } finally {
    result.dispose();
  }
}

async function loadSemanticPredictor(root = defaultModelRoot()): Promise<SemanticPredictor> {
  const extractor = new EssentiaModel.EssentiaTFInputExtractor(EssentiaWASM, "musicnn") as InputExtractor;
  const [backbone, voiceModel, ...heads] = await Promise.all([
    loadGraph(root, "msd_musicnn"),
    loadVoiceModel(root),
    ...MUSICNN_HEADS.map((head) => loadGraph(root, head.id)),
  ]);
  const headModels = Object.fromEntries(MUSICNN_HEADS.map((head, index) => [head.id, heads[index]]));
  const effnetBackbone = await ort.InferenceSession.create(join(root, "discogs_effnet", "model.onnx"));
  const effnetModels = Object.fromEntries(await Promise.all(EFFNET_HEADS.map(async (head) => [head.id, {
    model: await loadGraph(root, head.id),
    labels: await loadLabels(root, head.id),
  }] as const)));

  return async (audio16k) => {
    if (!hasAudibleSignal(audio16k)) return { mirexMood: {}, vocalProbability: 0 };
    const features = extractor.computeFrameWise(audio16k);
    const effnetFeatures = extractor.computeFrameWise(audio16k, 256);
    const featureTensor = batchFeatures(features);
    const training = tf.scalar(false);
    const embeddings = backbone.execute({
      "model/Placeholder": featureTensor,
      "model/Placeholder_1": training,
    }, "model/dense/BiasAdd") as tf.Tensor;
    try {
      const [danceRows, deamRows, mirexRows, voice] = await Promise.all([
        rowsFrom(headModels.danceability, embeddings),
        rowsFrom(headModels.deam, embeddings),
        rowsFrom(headModels.mirex_mood, embeddings),
        voiceModel.predict(features, true),
      ]);
      const patches = createEffnetPatches(effnetFeatures);
      if (patches.count === 0) throw new Error("EffNet requires at least 128 mel frames");
      const effnetResult = await effnetBackbone.run({
        melspectrogram: new ort.Tensor("float32", patches.data, [patches.count, 128, 96]),
      });
      const embeddingData = effnetResult.embeddings.data as Float32Array;
      const effnetEmbeddings = tf.tensor2d(embeddingData, [patches.count, 1280]);
      const mirexLabels = MUSICNN_HEADS.find((head) => head.id === "mirex_mood")!.labels;
      try {
        const effnetRows = Object.fromEntries(await Promise.all(EFFNET_HEADS.map(async (head) => [
          head.id,
          await rowsFrom(effnetModels[head.id].model, effnetEmbeddings),
        ] as const)));
        const labelScores = (id: "jamendo_moodtheme" | "jamendo_instrument" | "jamendo_genre" | "timbre") =>
          Object.fromEntries(effnetModels[id].labels.map((label, index) => [label, clamp(meanColumn(effnetRows[id], index))]));
        return {
          mirexMood: mirexMoodScores(mirexRows, mirexLabels),
          vocalProbability: probabilityForClass(voice, 1),
          danceability: clamp(meanColumn(danceRows, 0)),
          // DEAM is trained on the native 1..9 annotation scale.
          valence: clamp((meanColumn(deamRows, 0) - 1) / 8),
          arousal: clamp((meanColumn(deamRows, 1) - 1) / 8),
          approachability: clamp(meanColumn(effnetRows.approachability, 0)),
          engagement: clamp(meanColumn(effnetRows.engagement, 0)),
          themes: topLabelScores(labelScores("jamendo_moodtheme")),
          instruments: topLabelScores(labelScores("jamendo_instrument")),
          genres: topLabelScores(labelScores("jamendo_genre")),
          timbre: topLabelScores(labelScores("timbre"), 2, 0),
        };
      } finally {
        effnetEmbeddings.dispose();
      }
    } finally {
      featureTensor.dispose();
      training.dispose();
      embeddings.dispose();
    }
  };
}

let predictorPromise: Promise<SemanticPredictor> | undefined;

export function getSemanticPredictor(): Promise<SemanticPredictor> {
  predictorPromise ??= loadSemanticPredictor();
  return predictorPromise;
}
