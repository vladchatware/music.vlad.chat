import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SEMANTIC_MODELS } from "./modelCatalog";

if (!process.argv.includes("--accept-noncommercial-license")) {
  throw new Error(
    "Essentia model weights use CC BY-NC-SA 4.0. Re-run with --accept-noncommercial-license or obtain proprietary licensing.",
  );
}

const root = process.env.ESSENTIA_MODEL_DIR || join(process.cwd(), "workers/track-analysis/models");
const converterImage = process.env.ESSENTIA_CONVERTER_IMAGE || "music-analysis-model-converter";
const converterBin = process.env.ESSENTIA_CONVERTER_BIN;
await mkdir(root, { recursive: true });

async function run(command: string[], label: string) {
  const child = Bun.spawn(command, { stdout: "inherit", stderr: "pipe" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${label}: ${await new Response(child.stderr).text()}`);
}

async function download(url: string, destination: string, id: string) {
  await run(["curl", "--fail", "--location", "--silent", "--show-error", url, "--output", destination], `${id} download failed`);
}

for (const model of SEMANTIC_MODELS) {
  const temp = await mkdtemp(join(tmpdir(), `${model.id}-`));
  const destination = join(root, model.id);
  try {
    const artifact = join(destination, model.kind === "onnx" ? "model.onnx" : "model.json");
    if (!process.argv.includes("--force")) {
      try {
        await access(artifact);
        console.info("analysis.model_exists", { id: model.id });
        continue;
      } catch {
        // Prepare missing model.
      }
    }
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    if ("metadataUrl" in model) {
      await download(model.metadataUrl, join(destination, "metadata.json"), `${model.id} metadata`);
    }
    if (model.kind === "onnx") {
      await download(model.url, join(destination, "model.onnx"), model.id);
    } else if (model.kind === "archive") {
      const archive = join(temp, "model.zip");
      await download(model.url, archive, model.id);
      await run(["unzip", "-jo", archive, "-d", destination], `${model.id} unzip failed`);
    } else {
      const source = join(temp, "model.pb");
      await download(model.url, source, model.id);
      let convertedSource = source;
      let output = model.output.replace(/:0$/, "");
      if (model.kind === "frozen_function") {
        convertedSource = join(temp, "model-flat.pb");
        const mounted = converterBin ? temp : "/work";
        const flatten = [
          "import tensorflow as tf",
          "from tensorflow.python.framework.convert_to_constants import convert_variables_to_constants_v2",
          `gd=tf.compat.v1.GraphDef(); gd.ParseFromString(open('${mounted}/model.pb','rb').read())`,
          "wrapped=tf.compat.v1.wrap_function(lambda: tf.compat.v1.import_graph_def(gd,name=''),[])",
          `fn=wrapped.prune(wrapped.graph.as_graph_element('${model.input}'),wrapped.graph.as_graph_element('${model.output}'))`,
          "frozen=convert_variables_to_constants_v2(fn,lower_control_flow=True)",
          `tf.io.write_graph(frozen.graph.as_graph_def(),'${mounted}','model-flat.pb',as_text=False)`,
        ].join("; ");
        await run(converterBin
          ? ["python", "-c", flatten]
          : ["docker", "run", "--rm", "--entrypoint", "python", "-v", `${temp}:/work`, converterImage, "-c", flatten], `${model.id} flatten failed`);
      }
      await run(converterBin ? [
        converterBin, "--input_format=tf_frozen_model", `--output_node_names=${output}`,
        convertedSource, destination,
      ] : [
        "docker", "run", "--rm", "-v", `${temp}:/work/input`, "-v", `${destination}:/work/output`,
        converterImage, "--input_format=tf_frozen_model", `--output_node_names=${output}`,
        `/work/input/${convertedSource.endsWith("model-flat.pb") ? "model-flat.pb" : "model.pb"}`, "/work/output",
      ], `${model.id} conversion failed`);
    }
    console.info("analysis.model_prepared", { id: model.id });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await writeFile(join(root, "manifest.json"), JSON.stringify({
  preparedAt: new Date().toISOString(),
  source: "https://essentia.upf.edu/models/",
  license: "CC-BY-NC-SA-4.0",
  architecture: "one MusiCNN embedding backbone with compact classification heads",
  models: SEMANTIC_MODELS,
}, null, 2));
