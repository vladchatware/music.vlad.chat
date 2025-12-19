"use client";

import { type SoundCloudTrack } from "../types";

export function buildRevibePrompt(opts: {
  track: SoundCloudTrack | null;
  analysis: {
    section: string;
    overallEnergy: number;
    bassEnergy: number;
    bpm: number | null;
  };
  playback: {
    progress01: number;
    currentTimeSec: number;
  };
  theme?: string;
}): string {
  const { track, analysis, playback } = opts;
  const theme = opts.theme ?? "frutiger aero";

  const context = `
Current Track: ${track?.title ?? "Unknown"} by ${track?.user?.username ?? "Unknown"}
Section: ${analysis.section}
Energy: ${(analysis.overallEnergy * 100).toFixed(0)}% (Bass: ${(analysis.bassEnergy * 100).toFixed(0)}%)
Progress: ${(playback.progress01 * 100).toFixed(0)}%
Theme: ${theme}
  `.trim();

  return `
${context}

DJ, what's our move? 
1. If we are deep in the mix (progress > 70%) or the energy is shifting, find the next track to cue.
2. ALSO, react to the current sound. If energy is high, maybe boost the vibe/bass. If we are in a breakdown, maybe tweak the EQs for atmosphere.
3. Use the 'knobs' tool for sound adjustments and 'player' tool for the next track.
  `.trim();
}

