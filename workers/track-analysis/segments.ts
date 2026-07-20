import type { AnalysisSegment } from "../../lib/trackAnalysis";
import type { PhraseType } from "../../lib/dj/types";

type SegmentInput = {
  durationSec: number;
  energySamples: number[];
  energySampleRate: number;
  beatsSec: number[];
  downbeatsSec: number[];
  sections: ReadonlyArray<{ type: PhraseType; startTime: number; endTime: number }>;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function samplesBetween(input: SegmentInput, startSec: number, endSec: number): number[] {
  const start = Math.max(0, Math.floor(startSec * input.energySampleRate));
  const end = Math.min(input.energySamples.length, Math.ceil(endSec * input.energySampleRate));
  return input.energySamples.slice(start, end);
}

function classifySection(opts: {
  energy: number;
  slope: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  analyzed?: PhraseType;
}): PhraseType {
  if (opts.analyzed && opts.analyzed !== "unknown" && opts.analyzed !== "verse") {
    return opts.analyzed;
  }
  if (opts.startSec === 0 && opts.energy < 0.18) return "intro";
  if (opts.endSec >= opts.durationSec - 0.5 && opts.slope < -0.004) return "outro";
  if (opts.slope > 0.008) return "buildup";
  if (opts.energy >= 0.68) return "drop";
  if (opts.energy <= 0.38) return "breakdown";
  return "verse";
}

function beatIndex(beatsSec: number[], timeSec: number): number {
  let index = 0;
  while (index < beatsSec.length && beatsSec[index] < timeSec - 0.001) index += 1;
  return index;
}

function buildSegment(input: SegmentInput, startSec: number, endSec: number, index: number): AnalysisSegment {
  const samples = samplesBetween(input, startSec, endSec);
  const energy = mean(samples);
  const third = Math.max(1, Math.floor(samples.length / 3));
  const energySlope = (mean(samples.slice(-third)) - mean(samples.slice(0, third))) /
    Math.max(1, endSec - startSec);
  const rhythmicDensity = clamp01(
    samples.slice(1).reduce((sum, value, sampleIndex) =>
      sum + Math.abs(value - (samples[sampleIndex] ?? value)), 0
    ) / Math.max(0.08, samples.length * 0.08)
  );
  const analyzed = input.sections.find((section) =>
    section.startTime < endSec && section.endTime > startSec
  )?.type;
  const section = classifySection({
    energy,
    slope: energySlope,
    startSec,
    endSec,
    durationSec: input.durationSec,
    analyzed,
  });
  const sectionEntry = section === "buildup" ? 0.95
    : section === "intro" ? 0.85
      : section === "breakdown" ? 0.75
        : section === "verse" ? 0.68
          : 0.52;
  const sectionExit = section === "outro" ? 0.95
    : section === "breakdown" ? 0.82
      : energySlope < -0.004 ? 0.78
        : 0.55;
  const startBeat = beatIndex(input.beatsSec, startSec);
  const endBeat = Math.max(startBeat, beatIndex(input.beatsSec, endSec));

  return {
    id: `s${index}`,
    startSec,
    endSec,
    startBeat,
    endBeat,
    section,
    energy: Number(energy.toFixed(4)),
    energySlope: Number(energySlope.toFixed(5)),
    rhythmicDensity: Number(rhythmicDensity.toFixed(4)),
    entryQuality: Number(clamp01(sectionEntry + rhythmicDensity * 0.05).toFixed(4)),
    exitQuality: Number(clamp01(sectionExit + (1 - rhythmicDensity) * 0.05).toFixed(4)),
    confidence: 0.7,
    valence: null,
    arousal: null,
    vocalProbability: null,
    danceability: null,
    approachability: null,
    engagement: null,
    mirexMood: null,
    themes: null,
    instruments: null,
    genres: null,
    timbre: null,
  };
}

export function deriveAnalysisSegments(input: SegmentInput): AnalysisSegment[] {
  const downbeats = [...new Set([
    0,
    ...input.downbeatsSec.filter((time) => time > 0 && time < input.durationSec),
    input.durationSec,
  ])].sort((a, b) => a - b);
  const boundaries = [0];
  for (let beat = 16; beat < input.beatsSec.length; beat += 16) {
    const target = input.beatsSec[beat];
    const snapped = downbeats.find((time) => time >= target - 0.001 && time < input.durationSec);
    if (snapped !== undefined && snapped > (boundaries.at(-1) ?? 0)) boundaries.push(snapped);
  }
  if (boundaries.at(-1) !== input.durationSec) boundaries.push(input.durationSec);

  const raw = boundaries.slice(0, -1).map((start, index) =>
    buildSegment(input, start, boundaries[index + 1], index)
  );
  const merged: AnalysisSegment[] = [];
  for (const segment of raw) {
    const previous = merged.at(-1);
    if (previous && segment.endBeat - segment.startBeat < 16) {
      merged[merged.length - 1] = buildSegment(
        input,
        previous.startSec,
        segment.endSec,
        merged.length - 1,
      );
    } else {
      merged.push({ ...segment, id: `s${merged.length}` });
    }
  }
  return merged;
}
