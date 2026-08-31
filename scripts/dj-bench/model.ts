import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { BenchConfig } from "./config";

export function resolveBenchModel(config: BenchConfig): LanguageModel | string {
  if (config.provider === "gateway") return config.model;
  if (!config.providerApiKey || !config.providerBaseUrl) {
    throw new Error(`API key and base URL are required with ${config.provider} provider`);
  }
  if (config.provider === "zai" || !config.model.startsWith("gpt-")) {
    const compatible = createOpenAICompatible({
      name: config.provider === "zai" ? "zai" : "opencode-zen",
      apiKey: config.providerApiKey,
      baseURL: config.providerBaseUrl,
      includeUsage: true,
    });
    return compatible(config.model);
  }
  const opencode = createOpenAI({
    name: "opencode-zen",
    apiKey: config.providerApiKey,
    baseURL: config.providerBaseUrl,
  });
  return opencode.responses(config.model);
}
