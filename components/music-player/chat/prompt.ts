"use client";

import { type SoundCloudTrack } from "../types";

export const REVIBE_PROMPT =
  "Play hidden gems from my likes or similar tracks, matching frutiger aero";

export function buildRevibePrompt(opts: {
  track: SoundCloudTrack | null;
  detectedBpm: number | null;
  theme?: string;
  continuityMode?: boolean;
}): string {
  void opts;
  return REVIBE_PROMPT;
}
