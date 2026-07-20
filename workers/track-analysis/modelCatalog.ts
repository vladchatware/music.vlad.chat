const FEATURE_BASE = "https://essentia.upf.edu/models/feature-extractors/musicnn";
const HEAD_BASE = "https://essentia.upf.edu/models/classification-heads";
const CLASSIFIER_BASE = "https://essentia.upf.edu/models/classifiers";
const EFFNET_BASE = "https://essentia.upf.edu/models/feature-extractors/discogs-effnet";

export const MUSICNN_BACKBONE = {
  id: "msd_musicnn",
  kind: "frozen" as const,
  url: `${FEATURE_BASE}/msd-musicnn-1.pb`,
  output: "model/dense/BiasAdd",
  license: "CC-BY-NC-SA-4.0",
};

export const MUSICNN_HEADS = [
  {
    id: "danceability",
    kind: "frozen" as const,
    url: `${HEAD_BASE}/danceability/danceability-msd-musicnn-1.pb`,
    output: "model/Softmax",
    labels: ["danceable", "not_danceable"],
    license: "CC-BY-NC-SA-4.0",
  },
  {
    id: "deam",
    kind: "frozen" as const,
    url: `${HEAD_BASE}/deam/deam-msd-musicnn-2.pb`,
    output: "model/Identity",
    labels: ["valence", "arousal"],
    license: "CC-BY-NC-SA-4.0",
  },
  {
    id: "mirex_mood",
    kind: "frozen_function" as const,
    url: `${HEAD_BASE}/moods_mirex/moods_mirex-msd-musicnn-1.pb`,
    input: "serving_default_model_Placeholder:0",
    output: "PartitionedCall:0",
    labels: ["rousing", "cheerful", "wistful", "whimsical", "intense"],
    license: "CC-BY-NC-SA-4.0",
  },
] as const;

export const EFFNET_BACKBONE = {
  id: "discogs_effnet",
  kind: "onnx" as const,
  url: `${EFFNET_BASE}/discogs-effnet-bsdynamic-1.onnx`,
  license: "CC-BY-NC-SA-4.0",
};

const effnetHead = (id: string, path: string, filename: string, output: string) => ({
  id,
  kind: "frozen" as const,
  url: `${HEAD_BASE}/${path}/${filename}.pb`,
  metadataUrl: `${HEAD_BASE}/${path}/${filename}.json`,
  output,
  license: "CC-BY-NC-SA-4.0" as const,
});

export const EFFNET_HEADS = [
  effnetHead("approachability", "approachability", "approachability_regression-discogs-effnet-1", "model/Identity"),
  effnetHead("engagement", "engagement", "engagement_regression-discogs-effnet-1", "model/Identity"),
  effnetHead("jamendo_moodtheme", "mtg_jamendo_moodtheme", "mtg_jamendo_moodtheme-discogs-effnet-1", "model/Sigmoid"),
  effnetHead("jamendo_instrument", "mtg_jamendo_instrument", "mtg_jamendo_instrument-discogs-effnet-1", "model/Sigmoid"),
  effnetHead("jamendo_genre", "mtg_jamendo_genre", "mtg_jamendo_genre-discogs-effnet-1", "model/Sigmoid"),
  effnetHead("timbre", "timbre", "timbre-discogs-effnet-1", "model/Softmax"),
] as const;

export const ARCHIVE_MODELS = [{
  id: "voice_instrumental",
  kind: "archive" as const,
  url: `${CLASSIFIER_BASE}/voice_instrumental/voice_instrumental-musicnn-msd-2-tfjs.zip`,
  license: "CC-BY-NC-SA-4.0",
}] as const;

export const SEMANTIC_MODELS = [
  MUSICNN_BACKBONE,
  ...MUSICNN_HEADS,
  EFFNET_BACKBONE,
  ...EFFNET_HEADS,
  ...ARCHIVE_MODELS,
] as const;
