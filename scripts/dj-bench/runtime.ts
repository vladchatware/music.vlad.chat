import { z } from "zod";

import {
  playerToolInputSchema,
  type DJPerformancePlan,
  type PlayerToolInput,
} from "../../lib/dj";
import type { FailureName } from "./config";

export const performTransitionInputSchema = playerToolInputSchema
  .extend({
    expectedStateRevision: z.number().int().nonnegative(),
  })
  .strict();

export type PerformTransitionInput = z.infer<typeof performTransitionInputSchema>;

export interface CandidateTrack {
  id: number;
  title: string;
  artist?: string;
  bpm?: number;
  durationSec: number;
  genre?: string;
}

export interface TrackAnalysisRecord {
  trackId: number;
  analysis: Record<string, unknown>;
}

export interface InitialTrack {
  track: CandidateTrack;
  analysis: Record<string, unknown>;
}

interface MockDeck {
  id: "A" | "B";
  track: CandidateTrack | null;
  positionSec: number;
  status: "empty" | "playing" | "queued";
}

export interface TransitionOutcome {
  fromTrackId: number;
  toTrackId: number;
  acceptedAtSec: number;
  scheduledAtSec: number;
  blendDurationSec: number;
  performance: DJPerformancePlan;
}

export interface PerformTransitionResult {
  status: "accepted" | "rejected";
  reason?: string;
  instruction?: string;
  transition?: TransitionOutcome;
  stateRevision: number;
}

export interface RuntimeStats {
  stateReads: number;
  acceptedTransitions: number;
  rejectedTransitions: number;
  duplicateAttempts: number;
  impossibleScheduleAttempts: number;
}

const INITIAL_TRACK: CandidateTrack = {
  id: 100,
  title: "Mock Opening Track",
  artist: "Bench Runtime",
  bpm: 124,
  durationSec: 240,
  genre: "ambient house",
};

function textFromUnknown(value: unknown, seen = new Set<object>()): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => textFromUnknown(item, seen)).filter(Boolean).join("\n");
  }
  return Object.values(value as Record<string, unknown>)
    .map((item) => textFromUnknown(item, seen))
    .filter(Boolean)
    .join("\n");
}

function candidateFromObject(value: unknown): CandidateTrack | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "number" ||
    !Number.isSafeInteger(record.id) ||
    record.id <= 0 ||
    typeof record.title !== "string"
  ) {
    return null;
  }
  const rawDuration = typeof record.duration === "number" ? record.duration : undefined;
  return {
    id: record.id,
    title: record.title,
    artist:
      typeof record.artist === "string"
        ? record.artist
        : typeof (record.user as Record<string, unknown> | undefined)?.username === "string"
          ? String((record.user as Record<string, unknown>).username)
          : undefined,
    bpm: typeof record.bpm === "number" && record.bpm > 0 ? record.bpm : undefined,
    durationSec: rawDuration ? (rawDuration > 10_000 ? rawDuration / 1_000 : rawDuration) : 240,
    genre: typeof record.genre === "string" ? record.genre : undefined,
  };
}

function collectObjectCandidates(
  value: unknown,
  candidates: CandidateTrack[],
  seen = new Set<object>(),
) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  const candidate = candidateFromObject(value);
  if (candidate) candidates.push(candidate);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(child)) {
      for (const item of child) collectObjectCandidates(item, candidates, seen);
    } else {
      collectObjectCandidates(child, candidates, seen);
    }
  }
}

function parseEmbeddedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function positiveTrackId(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed > 0
    ? parsed
    : null;
}

function collectTrackAnalyses(
  value: unknown,
  analyses: TrackAnalysisRecord[],
  seen = new Set<object>(),
) {
  const parsed = parseEmbeddedJson(value);
  if (parsed !== value) {
    collectTrackAnalyses(parsed, analyses, seen);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectTrackAnalyses(item, analyses, seen);
    return;
  }

  const record = value as Record<string, unknown>;
  const analysis =
    record.analysis && typeof record.analysis === "object" && !Array.isArray(record.analysis)
      ? record.analysis as Record<string, unknown>
      : null;
  const trackId = positiveTrackId(analysis?.trackId ?? record.trackId ?? record.id);
  if (analysis && trackId && record.status !== "not_ready") {
    analyses.push({ trackId, analysis });
  }
  for (const child of Object.values(record)) {
    collectTrackAnalyses(child, analyses, seen);
  }
}

export function extractTrackAnalyses(value: unknown): TrackAnalysisRecord[] {
  const analyses: TrackAnalysisRecord[] = [];
  collectTrackAnalyses(value, analyses);
  return [...new Map(analyses.map((item) => [item.trackId, item])).values()];
}

function analysisNumber(analysis: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = analysis;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" && Number.isFinite(current) && current > 0
    ? current
    : undefined;
}

function enrichTrack(
  track: CandidateTrack,
  analysis: Record<string, unknown>,
): CandidateTrack {
  return {
    ...track,
    bpm: analysisNumber(analysis, ["tempo", "bpm"]) ?? track.bpm,
    durationSec: analysisNumber(analysis, ["durationSec"]) ?? track.durationSec,
  };
}

function selectedFields(
  value: unknown,
  fields: string[],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const selected = Object.fromEntries(
    fields
      .filter((field) => record[field] !== undefined)
      .map((field) => [field, record[field]]),
  );
  return Object.keys(selected).length > 0 ? selected : undefined;
}

function compactSegment(value: unknown): Record<string, unknown> | undefined {
  return selectedFields(value, [
    "id",
    "startSec",
    "endSec",
    "section",
    "energy",
    "energySlope",
    "rhythmicDensity",
    "exitQuality",
    "vocalProbability",
    "valence",
    "arousal",
    "genres",
    "instruments",
    "timbre",
  ]);
}

export function compactTrackAnalysis(
  analysis: Record<string, unknown>,
  positionSec: number,
): Record<string, unknown> {
  const rawSegments = Array.isArray(analysis.exitSegments)
    ? analysis.exitSegments
    : Array.isArray(analysis.entryOptions)
      ? analysis.entryOptions
      : [];
  const segments = rawSegments
    .flatMap((segment) => compactSegment(segment) ?? [])
    .sort((left, right) => {
      const leftStart = typeof left.startSec === "number" ? left.startSec : 0;
      const rightStart = typeof right.startSec === "number" ? right.startSec : 0;
      return Math.abs(leftStart - positionSec) - Math.abs(rightStart - positionSec);
    })
    .slice(0, 3);
  return {
    trackId: analysis.trackId,
    durationSec: analysis.durationSec,
    warnings: analysis.warnings,
    tempo: selectedFields(analysis.tempo, [
      "bpm",
      "confidence",
      "firstDownbeatSec",
      "downbeatConfidence",
    ]),
    tonal: selectedFields(analysis.tonal, [
      "camelotKey",
      "confidence",
      "key",
      "scale",
    ]),
    energy: selectedFields(analysis.energy, [
      "mean",
      "peak",
      "entry",
      "exit",
    ]),
    cuePoints: selectedFields(analysis.cuePoints, [
      "confidence",
      "mixInSec",
      "mixOutSec",
      "reason",
    ]),
    nearbyExitSegments: segments,
  };
}

export function extractCandidateTracks(value: unknown): CandidateTrack[] {
  const candidates: CandidateTrack[] = [];
  collectObjectCandidates(value, candidates);

  for (const line of textFromUnknown(value).split(/\r?\n/)) {
    const idMatch = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!idMatch) continue;
    const id = Number(idMatch[1]);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const rest = idMatch[2]!;
    const bpmMatch = /(?:^|[,(]\s*)(\d+(?:\.\d+)?)\s*BPM\b/i.exec(rest);
    const durationMatch = /(?:^|[,(]\s*)(\d+)\s*s(?:[,)])/i.exec(rest);
    const separator = rest.indexOf(" - ");
    candidates.push({
      id,
      artist: separator >= 0 ? rest.slice(0, separator).trim() : undefined,
      title: (separator >= 0 ? rest.slice(separator + 3) : rest).replace(/\s+\([^)]*\)\s*$/, "").trim(),
      bpm: bpmMatch ? Number(bpmMatch[1]) : undefined,
      durationSec: durationMatch ? Number(durationMatch[1]) : 240,
    });
  }

  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
}

function blendDurationSec(plan: DJPerformancePlan, bpm: number): number {
  if (
    "seconds" in plan.blend.duration &&
    typeof plan.blend.duration.seconds === "number"
  ) {
    return plan.blend.duration.seconds;
  }
  const bars = "bars" in plan.blend.duration ? plan.blend.duration.bars : undefined;
  if (typeof bars !== "number") throw new Error("Validated blend duration has no value");
  return bars * 4 * (60 / bpm);
}

function entryTimeSec(plan: DJPerformancePlan): number {
  if (plan.entry.anchor === "time") return plan.entry.timeSec;
  if (plan.entry.anchor === "first_downbeat") return 0;
  if (plan.entry.anchor === "mix_in") return 16;
  return plan.entry.section === "intro" ? 8 : 32;
}

function normalizedTempoAdjustmentPercent(outgoingBpm: number, incomingBpm: number): number {
  const variants = [incomingBpm / 2, incomingBpm, incomingBpm * 2];
  const equivalent = variants.sort(
    (left, right) => Math.abs(left - outgoingBpm) - Math.abs(right - outgoingBpm),
  )[0]!;
  return Math.abs(outgoingBpm / equivalent - 1) * 100;
}

export class MockDJRuntime {
  private simulatedTimeSec: number;
  private revision = 1;
  private activeDeckId: "A" | "B" = "A";
  private decks: Record<"A" | "B", MockDeck>;
  private candidates = new Map<number, CandidateTrack>();
  private analyses = new Map<number, Record<string, unknown>>();
  private playedTrackIds: number[];
  private outcomes: TransitionOutcome[] = [];
  private acceptedInTurn = false;
  private actionAttemptsInTurn = 0;
  private injectedFailures = new Set<FailureName>();
  private consumedFailures = new Set<FailureName>();

  readonly stats: RuntimeStats = {
    stateReads: 0,
    acceptedTransitions: 0,
    rejectedTransitions: 0,
    duplicateAttempts: 0,
    impossibleScheduleAttempts: 0,
  };

  constructor(
    failures: Iterable<FailureName> = [],
    readonly clockSpeed = 1,
    initial?: InitialTrack,
    readonly planningLeadSec = 90,
  ) {
    this.injectedFailures = new Set(failures);
    const initialTrack = initial
      ? enrichTrack(initial.track, initial.analysis)
      : INITIAL_TRACK;
    const positionSec = Math.max(0, initialTrack.durationSec - planningLeadSec);
    this.simulatedTimeSec = positionSec;
    this.decks = {
      A: { id: "A", track: initialTrack, positionSec, status: "playing" },
      B: { id: "B", track: null, positionSec: 0, status: "empty" },
    };
    this.playedTrackIds = [initialTrack.id];
    if (initial) this.analyses.set(initialTrack.id, initial.analysis);
  }

  get nowSec() {
    return this.simulatedTimeSec;
  }

  get acceptedThisTurn() {
    return this.acceptedInTurn;
  }

  get transitionOutcomes(): readonly TransitionOutcome[] {
    return this.outcomes;
  }

  analysisFor(trackId: number): Record<string, unknown> | undefined {
    return this.analyses.get(trackId);
  }

  beginTurn() {
    this.acceptedInTurn = false;
    this.actionAttemptsInTurn = 0;
  }

  elapseWallMs(milliseconds: number) {
    this.advance(milliseconds / 1_000 * this.clockSpeed);
  }

  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.simulatedTimeSec += seconds;
    const active = this.decks[this.activeDeckId];
    active.positionSec += seconds;
  }

  registerCandidates(value: unknown): CandidateTrack[] {
    const discovered = extractCandidateTracks(value);
    for (const candidate of discovered) {
      const analysis = this.analyses.get(candidate.id);
      this.candidates.set(
        candidate.id,
        analysis ? enrichTrack(candidate, analysis) : candidate,
      );
    }
    return discovered;
  }

  registerTrackAnalyses(value: unknown): TrackAnalysisRecord[] {
    const discovered = extractTrackAnalyses(value);
    for (const { trackId, analysis } of discovered) {
      this.analyses.set(trackId, analysis);
      const candidate = this.candidates.get(trackId);
      if (candidate) this.candidates.set(trackId, enrichTrack(candidate, analysis));
      const active = this.decks[this.activeDeckId];
      if (active.track?.id === trackId) {
        active.track = enrichTrack(active.track, analysis);
      }
    }
    return discovered;
  }

  readState() {
    this.stats.stateReads += 1;
    return this.snapshot();
  }

  snapshot() {
    const active = this.decks[this.activeDeckId];
    return {
      stateRevision: this.revision,
      simulatedTimeSec: this.simulatedTimeSec,
      clockSpeed: this.clockSpeed,
      activeDeck: this.activeDeckId,
      decks: this.decks,
      activeTrack: active.track,
      activeTrackAnalysis: active.track
        ? (() => {
            const analysis = this.analyses.get(active.track!.id);
            return analysis
              ? compactTrackAnalysis(analysis, active.positionSec)
              : null;
          })()
        : null,
      currentTimeSec: active.positionSec,
      durationSec: active.track?.durationSec ?? 0,
      section: this.sectionFor(active),
      transition: null,
      playedTrackIds: [...this.playedTrackIds],
      candidateTrackIds: [...this.candidates.keys()].filter(
        (id) => !this.playedTrackIds.includes(id),
      ),
      recentTransitionOutcomes: this.outcomes.slice(-4),
    };
  }

  performTransition(rawInput: unknown): PerformTransitionResult {
    const parsed = performTransitionInputSchema.safeParse(rawInput);
    this.actionAttemptsInTurn += 1;
    if (!parsed.success) {
      return this.reject("invalid_schema", parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    const input = parsed.data;

    if (this.acceptedInTurn) {
      return this.reject("action_already_accepted", "Wait for next planning turn.");
    }
    if (
      this.consumeFailure("stale-state") &&
      input.expectedStateRevision === this.revision
    ) {
      this.revision += 1;
    }
    if (input.expectedStateRevision !== this.revision) {
      return this.reject("stale_state", "Call dj_state and retry with its latest stateRevision.");
    }
    if (this.playedTrackIds.includes(input.id)) {
      this.stats.duplicateAttempts += 1;
      return this.reject("duplicate_track", "Choose an unplayed discovered track.");
    }
    const candidate = this.candidates.get(input.id);
    if (!candidate) {
      return this.reject("undiscovered_track", "Choose an ID returned by likes or tracks.");
    }
    if (
      this.consumeFailure("reject-first") ||
      this.consumeFailure("unavailable-track")
    ) {
      return this.reject("track_unavailable", "Refresh state and choose a different discovered track.");
    }

    const active = this.decks[this.activeDeckId];
    const activeTrack = active.track;
    if (!activeTrack) return this.reject("no_active_track", "Refresh state.");

    if (this.consumeFailure("late-decision")) {
      active.positionSec = Math.max(active.positionSec, activeTrack.durationSec - 2);
    }
    const emergencyCut =
      input.performance.blend.crossfaderCurve === "cut" &&
      "seconds" in input.performance.blend.duration &&
      typeof input.performance.blend.duration.seconds === "number" &&
      input.performance.blend.duration.seconds <= 1;
    const minimumRunwaySec = emergencyCut ? 0.25 : 4;
    if (active.positionSec + minimumRunwaySec >= activeTrack.durationSec) {
      this.stats.impossibleScheduleAttempts += 1;
      return this.reject("late_decision", "No safe runway remains. Call dj_state and choose an emergency clean cut.");
    }

    let requestedExitSec: number;
    if (input.performance.exit.anchor === "time") {
      requestedExitSec = input.performance.exit.timeSec;
      if (requestedExitSec < active.positionSec + minimumRunwaySec) {
        this.stats.impossibleScheduleAttempts += 1;
        return this.reject("exit_in_past", "Choose a future exit at least four seconds from current position.");
      }
    } else {
      requestedExitSec = Math.max(
        input.performance.exit.notBeforeSec ?? 0,
        active.positionSec + Math.max(8, minimumRunwaySec),
      );
    }

    const incomingStartSec = entryTimeSec(input.performance);
    if (incomingStartSec >= candidate.durationSec - 4) {
      this.stats.impossibleScheduleAttempts += 1;
      return this.reject("entry_out_of_range", "Choose an earlier incoming entry.");
    }

    if (input.performance.tempo.mode === "match" && candidate.bpm) {
      const adjustment = normalizedTempoAdjustmentPercent(activeTrack.bpm ?? 120, candidate.bpm);
      const maximum = input.performance.tempo.maxAdjustmentPercent ?? 8;
      if (adjustment > maximum) {
        return this.reject(
          "unsafe_tempo_adjustment",
          `Required adjustment ${adjustment.toFixed(2)}% exceeds ${maximum}%. Preserve tempo or choose another track.`,
        );
      }
    }

    const blendSec = blendDurationSec(input.performance, activeTrack.bpm ?? 120);
    const scheduledAtSec = emergencyCut
      ? active.positionSec + minimumRunwaySec
      : Math.max(
          active.positionSec + 8,
          requestedExitSec ?? activeTrack.durationSec - Math.max(24, blendSec),
        );
    if (scheduledAtSec + blendSec > activeTrack.durationSec + 1) {
      this.stats.impossibleScheduleAttempts += 1;
      return this.reject("blend_exceeds_track", "Choose earlier exit or shorter blend.");
    }

    const transition: TransitionOutcome = {
      fromTrackId: activeTrack.id,
      toTrackId: candidate.id,
      acceptedAtSec: this.simulatedTimeSec,
      scheduledAtSec,
      blendDurationSec: blendSec,
      performance: input.performance,
    };
    const incomingDeckId = this.activeDeckId === "A" ? "B" : "A";
    this.decks[incomingDeckId] = {
      id: incomingDeckId,
      track: candidate,
      positionSec: incomingStartSec,
      status: "queued",
    };
    this.outcomes.push(transition);
    this.playedTrackIds.push(candidate.id);
    this.acceptedInTurn = true;
    this.revision += 1;
    this.stats.acceptedTransitions += 1;
    return { status: "accepted", transition, stateRevision: this.revision };
  }

  advanceToNextPlanningWindow(planningLeadSec = this.planningLeadSec) {
    if (!this.acceptedInTurn) {
      throw new Error("Cannot advance without accepted transition");
    }
    const incomingDeckId = this.activeDeckId === "A" ? "B" : "A";
    const outgoingDeckId = this.activeDeckId;
    const incoming = this.decks[incomingDeckId];
    if (!incoming.track) throw new Error("Accepted transition has no incoming track");

    this.decks[outgoingDeckId] = {
      id: outgoingDeckId,
      track: null,
      positionSec: 0,
      status: "empty",
    };
    this.activeDeckId = incomingDeckId;
    incoming.status = "playing";
    incoming.positionSec = Math.max(
      incoming.positionSec,
      Math.max(0, incoming.track.durationSec - planningLeadSec),
    );
    this.simulatedTimeSec += planningLeadSec;
    this.revision += 1;
  }

  private reject(reason: string, instruction: string): PerformTransitionResult {
    this.stats.rejectedTransitions += 1;
    return {
      status: "rejected",
      reason,
      instruction,
      stateRevision: this.revision,
    };
  }

  private consumeFailure(name: FailureName): boolean {
    if (!this.injectedFailures.has(name) || this.consumedFailures.has(name)) return false;
    this.consumedFailures.add(name);
    return true;
  }

  private sectionFor(deck: MockDeck): string {
    if (!deck.track) return "empty";
    const progress = deck.positionSec / deck.track.durationSec;
    if (progress < 0.15) return "intro";
    if (progress > 0.85) return "outro";
    if (progress > 0.55 && progress < 0.78) return "drop";
    return "body";
  }
}

export function toPlayerToolInput(input: PerformTransitionInput): PlayerToolInput {
  return { id: input.id, performance: input.performance };
}
