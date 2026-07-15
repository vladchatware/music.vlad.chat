import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { io } from "@tensorflow/tfjs";

type ModelJson = {
  modelTopology: unknown;
  format?: string;
  generatedBy?: string;
  convertedBy?: string;
  weightsManifest?: Array<{
    paths: string[];
    weights: io.WeightsManifestEntry[];
  }>;
};

export function createLocalModelIOHandler(modelJsonPath: string): io.IOHandler {
  return {
    async load() {
      const descriptor = JSON.parse(await readFile(modelJsonPath, "utf8")) as ModelJson;
      const manifests = descriptor.weightsManifest ?? [];
      const shardPaths = manifests.flatMap((manifest) => manifest.paths);
      const shards = await Promise.all(
        shardPaths.map((path) => readFile(join(dirname(modelJsonPath), path))),
      );
      const weightBytes = Buffer.concat(shards);
      return {
        modelTopology: descriptor.modelTopology,
        format: descriptor.format,
        generatedBy: descriptor.generatedBy,
        convertedBy: descriptor.convertedBy,
        weightSpecs: manifests.flatMap((manifest) => manifest.weights),
        weightData: weightBytes.buffer.slice(
          weightBytes.byteOffset,
          weightBytes.byteOffset + weightBytes.byteLength,
        ),
      };
    },
  };
}
