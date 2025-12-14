"use client";

import { type SoundCloudTrack } from "../types";

export function buildRevibePrompt(opts: {
  track: SoundCloudTrack | null;
  detectedBpm: number | null;
  theme?: string;
}): string {
  const theme = opts.theme ?? "frutiger aero";

  // Current behavior: the prompt is always themed.
  // (We keep the richer hint-building logic for future iterations.)
  return `Play hidden gems from my likes or similar tracks, matching ${theme}`;
}

