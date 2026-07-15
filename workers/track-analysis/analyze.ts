import { Essentia, EssentiaWASM } from "essentia.js";
import { parseKey } from "../../lib/dj/harmonic/camelot";
import { analyzeStructure } from "../../lib/dj/structure/analyzer";
import type { BeatGrid, PhraseType } from "../../lib/dj/types";
import type { TrackAnalysis } from "../../lib/trackAnalysis";
import {
  ENERGY_SAMPLE_RATE,
  ANALYSIS_SAMPLE_RATE,
} from "./config";
import { deriveAnalysisSegments } from "./segments";

type EssentiaVector = {
  size(): number;
  get(index: number): number;
  delete?(): void;
};

function vectorToNumbers(vector: EssentiaVector): number[] {
  const result: number[] = [];
  for (let index = 0; index < vector.size(); index += 1) result.push(vector.get(index));
  vector.delete?.();
  return result;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function computeEnergy(signal: Float32Array): {
  samples: number[];
  peaks: number[];
  valleys: number[];
} {
  const frameSize = Math.floor(ANALYSIS_SAMPLE_RATE / ENERGY_SAMPLE_RATE);
  const raw: number[] = [];
  for (let offset = 0; offset < signal.length; offset += frameSize) {
    const end = Math.min(signal.length, offset + frameSize);
    let sumSquares = 0;
    for (let index = offset; index < end; index += 1) {
      sumSquares += signal[index] * signal[index];
    }
    raw.push(Math.sqrt(sumSquares / Math.max(1, end - offset)));
  }
  const max = Math.max(...raw, Number.EPSILON);
  const samples = raw.map((value) => clamp01(Math.sqrt(value / max)));
  const peaks: number[] = [];
  const valleys: number[] = [];
  for (let index = 1; index < samples.length - 1; index += 1) {
    if (samples[index] > samples[index - 1] && samples[index] >= samples[index + 1]) peaks.push(index);
    if (samples[index] < samples[index - 1] && samples[index] <= samples[index + 1]) valleys.push(index);
  }
  return { samples, peaks, valleys };
}

function sampleBeatEnergy(signal: Float32Array, beatSec: number): number {
  const start = Math.max(0, Math.floor((beatSec - 0.03) * ANALYSIS_SAMPLE_RATE));
  const end = Math.min(signal.length, Math.floor((beatSec + 0.12) * ANALYSIS_SAMPLE_RATE));
  let sumSquares = 0;
  for (let index = start; index < end; index += 1) sumSquares += signal[index] ** 2;
  return Math.sqrt(sumSquares / Math.max(1, end - start));
}

export function estimateDownbeats(signal: Float32Array, beatsSec: number[]) {
  if (beatsSec.length < 8) {
    return {
      firstDownbeatSec: beatsSec[0] ?? 0,
      downbeatsSec: beatsSec.filter((_, index) => index % 4 === 0),
      confidence: 0,
    };
  }
  const phaseEnergy = [0, 0, 0, 0];
  const phaseCount = [0, 0, 0, 0];
  beatsSec.forEach((beat, index) => {
    const phase = index % 4;
    phaseEnergy[phase] += sampleBeatEnergy(signal, beat);
    phaseCount[phase] += 1;
  });
  const averages = phaseEnergy.map((sum, phase) => sum / Math.max(1, phaseCount[phase]));
  const sorted = [...averages].sort((a, b) => b - a);
  const bestPhase = averages.indexOf(sorted[0]);
  const confidence = clamp01((sorted[0] - sorted[1]) / Math.max(sorted[0], Number.EPSILON));
  return {
    firstDownbeatSec: beatsSec[bestPhase] ?? beatsSec[0],
    downbeatsSec: beatsSec.filter((_, index) => index >= bestPhase && (index - bestPhase) % 4 === 0),
    confidence,
  };
}

export function deriveCuePoints(
  durationSec: number,
  bpm: number,
  sections: ReadonlyArray<{ type: PhraseType; startTime: number; endTime: number }>,
) {
  const barSec = (60 / Math.max(40, bpm)) * 4;
  const minimumEntrySec = barSec * 4;
  const sectionEntry = sections.find((section) =>
    section.startTime >= minimumEntrySec &&
    section.type !== "outro"
  )?.startTime;
  const outro = sections.find((section) => section.type === "outro");
  const targetEntrySec = sectionEntry ?? barSec * 8;
  const boundedEntrySec = Math.max(
    0,
    Math.min(durationSec * 0.35, durationSec - barSec * 8, targetEntrySec),
  );
  const mixInSec = Math.max(0, Math.round(boundedEntrySec / barSec) * barSec);
  const defaultMixOut = Math.max(mixInSec + barSec * 4, durationSec - barSec * 16);
  const mixOutSec = Math.min(durationSec - Math.min(2, barSec), outro?.startTime ?? defaultMixOut);
  return {
    mixInSec,
    mixOutSec: Math.max(mixInSec, mixOutSec),
    confidence: clamp01(sections.length > 1 ? 0.8 : 0.4),
    reason: sectionEntry !== undefined
      ? "section-aligned entry"
      : outro
        ? "phrase entry with analyzed outro"
        : "phrase-sized entry and exit",
  };
}

export function analyzePcm(
  signal: Float32Array,
  sourceTrackId: string,
  analysisVersion: string,
  processingStartedAt = Date.now(),
): TrackAnalysis {
  const durationSec = signal.length / ANALYSIS_SAMPLE_RATE;
  const warnings: string[] = [];
  const essentia = new Essentia(EssentiaWASM);
  const vector = essentia.arrayToVector(signal);
  try {
    const rhythm = essentia.RhythmExtractor2013(vector, 200, "multifeature", 40);
    const beatsSec = vectorToNumbers(rhythm.ticks).filter(
      (value) => Number.isFinite(value) && value >= 0 && value <= durationSec,
    );
    rhythm.estimates?.delete?.();
    rhythm.bpmIntervals?.delete?.();
    const bpm = Number.isFinite(rhythm.bpm) && rhythm.bpm > 0 ? rhythm.bpm : 120;
    const tempoConfidence = clamp01(rhythm.confidence);
    if (tempoConfidence < 0.25) warnings.push("low tempo confidence");

    const keyResult = essentia.KeyExtractor(
      vector,
      true,
      4096,
      4096,
      12,
      3500,
      60,
      25,
      0.2,
      "bgate",
      ANALYSIS_SAMPLE_RATE,
    );
    const key = String(keyResult.key || "");
    const scale = String(keyResult.scale || "");
    const keyConfidence = clamp01(keyResult.strength);
    if (keyConfidence < 0.25) warnings.push("low key confidence");

    const energy = computeEnergy(signal);
    const downbeats = estimateDownbeats(signal, beatsSec);
    if (downbeats.confidence < 0.1) warnings.push("low downbeat confidence");
    const grid: BeatGrid = {
      bpm,
      beatsPerBar: 4,
      firstDownbeat: downbeats.firstDownbeatSec,
      beats: beatsSec,
      confidence: tempoConfidence,
    };
    const structure = analyzeStructure(
      Float32Array.from(energy.samples),
      ENERGY_SAMPLE_RATE,
      grid,
      durationSec,
    );
    const segments = deriveAnalysisSegments({
      durationSec,
      energySamples: energy.samples,
      energySampleRate: ENERGY_SAMPLE_RATE,
      beatsSec,
      downbeatsSec: downbeats.downbeatsSec,
      sections: structure.sections,
    });
    const defaultCuePoints = deriveCuePoints(durationSec, bpm, structure.sections);
    const bestEntry = segments
      .filter((segment) => segment.startSec <= durationSec * 0.35)
      .sort((a, b) => b.entryQuality - a.entryQuality)[0];
    const cuePoints = bestEntry
      ? {
          ...defaultCuePoints,
          mixInSec: bestEntry.startSec,
          confidence: Math.max(defaultCuePoints.confidence, bestEntry.confidence),
          reason: `segment ${bestEntry.id} ${bestEntry.section} entry`,
        }
      : defaultCuePoints;
    const keySignature = `${key}${scale.toLowerCase().startsWith("minor") ? "m" : ""}`;

    return {
      source: "soundcloud",
      sourceTrackId,
      analysisVersion,
      durationSec,
      processingTimeMs: Date.now() - processingStartedAt,
      warnings,
      tempo: {
        bpm,
        confidence: tempoConfidence,
        beatsSec,
        firstDownbeatSec: downbeats.firstDownbeatSec,
        downbeatsSec: downbeats.downbeatsSec,
        downbeatConfidence: downbeats.confidence,
      },
      tonal: {
        key,
        scale,
        camelotKey: parseKey(keySignature) ?? undefined,
        confidence: keyConfidence,
      },
      energy: { sampleRate: ENERGY_SAMPLE_RATE, ...energy },
      structure: {
        phrases: [...structure.phrases],
        downbeats: downbeats.downbeatsSec,
        sections: [...structure.sections],
      },
      segments,
      cuePoints,
    };
  } finally {
    vector.delete?.();
    essentia.delete();
  }
}
