import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { BenchConfig } from "./config";

export function resolveBenchModel(config: BenchConfig): LanguageModel | string {
  if (config.provider === "gateway") return config.model;
  if (!config.opencodeApiKey) {
    throw new Error("OPENCODE_API_KEY is required with OpenCode provider");
  }
  if (!config.model.startsWith("gpt-")) {
    const opencodeCompatible = createOpenAICompatible({
      name: "opencode-zen",
      apiKey: config.opencodeApiKey,
      baseURL: config.opencodeBaseUrl,
      includeUsage: true,
    });
    return opencodeCompatible(config.model);
  }
  const opencode = createOpenAI({
    name: "opencode-zen",
    apiKey: config.opencodeApiKey,
    baseURL: config.opencodeBaseUrl,
  });
  return opencode.responses(config.model);
}
