import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalModelIOHandler } from "./modelArtifacts";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("createLocalModelIOHandler", () => {
  it("loads topology, specs, and ordered weight shards from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dj-model-"));
    dirs.push(dir);
    await writeFile(join(dir, "a.bin"), Uint8Array.from([1, 2]));
    await writeFile(join(dir, "b.bin"), Uint8Array.from([3, 4]));
    await writeFile(join(dir, "model.json"), JSON.stringify({
      modelTopology: { node: [] },
      weightsManifest: [{ paths: ["a.bin", "b.bin"], weights: [{ name: "x", shape: [1], dtype: "float32" }] }],
    }));

    const artifacts = await createLocalModelIOHandler(join(dir, "model.json")).load();
    expect(artifacts.modelTopology).toEqual({ node: [] });
    expect(artifacts.weightSpecs).toEqual([{ name: "x", shape: [1], dtype: "float32" }]);
    expect([...new Uint8Array(artifacts.weightData as ArrayBuffer)]).toEqual([1, 2, 3, 4]);
  });
});
