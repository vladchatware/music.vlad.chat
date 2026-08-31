"use client";

import { type SoundCloudTrack } from "../types";
import { DEFAULT_DJ_PROMPT } from "@/lib/dj/agentInstructions";

export const REVIBE_PROMPT = DEFAULT_DJ_PROMPT;

export function buildRevibePrompt(opts: {
  track: SoundCloudTrack | null;
  detectedBpm: number | null;
  theme?: string;
  continuityMode?: boolean;
}): string {
  void opts;
  return REVIBE_PROMPT;
}
