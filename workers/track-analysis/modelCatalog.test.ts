import { describe, expect, it } from "vitest";

import { EFFNET_BACKBONE, EFFNET_HEADS, MUSICNN_BACKBONE, MUSICNN_HEADS, SEMANTIC_MODELS } from "./modelCatalog";

describe("semantic model catalog", () => {
  it("uses one shared backbone for compact semantic heads", () => {
    expect(SEMANTIC_MODELS).toHaveLength(12);
    expect(MUSICNN_BACKBONE.id).toBe("msd_musicnn");
    expect(MUSICNN_HEADS.map((model) => model.id)).toEqual([
      "danceability", "deam", "mirex_mood",
    ]);
    expect(EFFNET_BACKBONE.kind).toBe("onnx");
    expect(EFFNET_HEADS.map((model) => model.id)).toEqual([
      "approachability", "engagement", "jamendo_moodtheme",
      "jamendo_instrument", "jamendo_genre", "timbre",
    ]);
    expect(SEMANTIC_MODELS.map((model) => model.id)).toContain("voice_instrumental");
    expect(SEMANTIC_MODELS.every((model) => model.url.startsWith("https://essentia.upf.edu/models/"))).toBe(true);
  });
});
