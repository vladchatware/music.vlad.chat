"use client";

import { type SoundCloudTrack } from "../types";

export function buildRevibePrompt(opts: {
  track: SoundCloudTrack | null;
  detectedBpm: number | null;
  theme?: string;
  continuityMode?: boolean;
}): string {
  const theme = opts.theme ?? "frutiger aero";
  const continuityMode = opts.continuityMode === true;

  if (continuityMode) {
    return "Continuity mode: prepare one next track for a late transition near the ending section. Preserve current vibe and energy. Reuse previously fetched candidates first. Do not call likes again unless no valid candidates remain. Call player once with the selected track.";
  }

  // Current behavior: the prompt is always themed.
  // (We keep the richer hint-building logic for future iterations.)
  return `Play hidden gems from my likes or similar tracks, matching ${theme}`;
}
