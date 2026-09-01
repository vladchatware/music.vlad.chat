import { getCurveByPreset } from "../eq/curves";
import { createTransitionPlan } from "../engine/transitionPlanner";
import { DEFAULT_ANALYSIS_SNAPSHOT } from "../engine/types";
import { getNextPhraseBoundary } from "../tempo/beatgrid";
import { scoreSegmentPair } from "../segments/scoring";
import type { TempoMatchResult } from "../types";
import { normalizeTransitionMechanics } from "./mechanics";
import type {
  CompiledPerformancePlan,
  DJPerformancePlan,
  PerformanceLiveState,
} from "./types";

const EQ_PRESETS = {
  bass_swap: "bassSwap",
  frequency_split: "frequencySplit",
  smooth: "smooth",
  high_first: "highFirst",
} as const;

export const MIN_INCOMING_CONTINUITY_RUNWAY_SEC = 60;

function durationOf(deck: PerformanceLiveState["outgoingDeck"]): number {
  return Math.max(1.5, deck.track.duration ?? 300);
}

function effectiveGrid(deck: PerformanceLiveState["outgoingDeck"]) {
  return deck.beatGrid ?? {
    bpm: deck.track.bpm ?? 120,
    beatsPerBar: 4,
    firstDownbeat: 0,
    confidence: 0,
  };
}

function resolveSectionTime(
  deck: PerformanceLiveState["outgoingDeck"],
  section: string,
  afterSec = 0,
): number | null {
  const match = deck.structureMap?.sections.find(
    (candidate) => candidate.type === section && candidate.startTime >= afterSec,
  );
  return match?.startTime ?? null;
}

function preserveTempo(): TempoMatchResult {
  return {
    targetPlaybackRate: 1,
    phaseOffsetMs: 0,
    confidence: 1,
    feasible: true,
  };
}

function resolveExit(
  exit: DJPerformancePlan["exit"],
  deck: PerformanceLiveState["outgoingDeck"],
  minExitSec: number,
  fallbackExitSec: number,
) {
  const ignored: string[] = [];
  const adjustments: string[] = [];
  let requestedExitSec: number | null;
  switch (exit.anchor) {
    case "mix_out":
      requestedExitSec = deck.cuePoints?.mixOutSec ?? null;
      break;
    case "time":
      requestedExitSec = exit.timeSec;
      break;
    case "section":
      requestedExitSec = resolveSectionTime(deck, exit.section, minExitSec);
      break;
    case "next_phrase":
      requestedExitSec = minExitSec;
      break;
  }
  if (requestedExitSec === null) {
    requestedExitSec = fallbackExitSec;
    ignored.push("exit_anchor_unavailable");
  }

  const grid = effectiveGrid(deck);
  const phraseTarget = requestedExitSec < minExitSec ? minExitSec : requestedExitSec;
  if (requestedExitSec < minExitSec) adjustments.push("exit_moved_to_next_phrase");
  const phraseExitSec = getNextPhraseBoundary(grid, phraseTarget - 0.01, 4);
  const boundedExitSec = Math.max(
    minExitSec,
    Math.min(durationOf(deck) - 0.25, phraseExitSec),
  );
  if (boundedExitSec !== phraseExitSec) adjustments.push("exit_clamped_to_runway");
  return { exitSec: boundedExitSec, adjustments, ignored };
}

function resolveMixInEntry(
  intent: DJPerformancePlan,
  live: PerformanceLiveState,
  exitSec: number,
) {
  const outgoingSegment = live.outgoingDeck.segments?.find((segment) =>
    exitSec >= segment.startSec && exitSec < segment.endSec
  ) ?? live.outgoingDeck.segments?.at(-1);
  const rankedEntry = outgoingSegment
    ? [...(live.incomingDeck.segments ?? [])]
        .map((segment) => ({
          segment,
          score: scoreSegmentPair(outgoingSegment, segment, intent.energyArc),
        }))
        .sort((a, b) => b.score.overall - a.score.overall)[0]
    : undefined;
  return rankedEntry
    ? { entrySec: rankedEntry.segment.startSec, accepted: ["segment_pair"], ignored: [] }
    : {
        entrySec: live.incomingDeck.cuePoints?.mixInSec ?? 0,
        accepted: [],
        ignored: ["segment_pair_unavailable"],
      };
}

function resolveEntry(
  intent: DJPerformancePlan,
  live: PerformanceLiveState,
  exitSec: number,
) {
  const ignored: string[] = [];
  const adjustments: string[] = [];
  const accepted: string[] = [];
  const incomingGrid = effectiveGrid(live.incomingDeck);
  let entrySec = 0;

  if (intent.entry.anchor === "mix_in") {
    const mixIn = resolveMixInEntry(intent, live, exitSec);
    entrySec = mixIn.entrySec;
    accepted.push(...mixIn.accepted);
    ignored.push(...mixIn.ignored);
  }
  if (intent.entry.anchor === "first_downbeat") entrySec = incomingGrid.firstDownbeat;
  if (intent.entry.anchor === "time") entrySec = intent.entry.timeSec;
  if (intent.entry.anchor === "section") {
    const sectionTime = resolveSectionTime(live.incomingDeck, intent.entry.section);
    if (sectionTime === null) ignored.push("entry_section_unavailable");
    else entrySec = sectionTime;
  }
  if (
    entrySec < 4 &&
    intent.entry.anchor !== "time" &&
    intent.energyArc !== "reset" &&
    (live.incomingDeck.cuePoints?.mixInSec ?? 0) >= 4
  ) {
    entrySec = live.incomingDeck.cuePoints!.mixInSec;
    adjustments.push("entry_moved_from_file_start_to_mix_in");
  }
  if (intent.entry.anchor === "time" && incomingGrid.confidence >= 0.25) {
    const snappedEntrySec = getNextPhraseBoundary(incomingGrid, entrySec - 0.01, 1);
    if (Math.abs(snappedEntrySec - entrySec) > 0.001) {
      adjustments.push("entry_snapped_to_bar");
    }
    entrySec = snappedEntrySec;
  }
  entrySec = Math.max(0, Math.min(durationOf(live.incomingDeck) - 0.1, entrySec));
  return { entrySec, accepted, adjustments, ignored };
}

function requestedBlendDurationSec(intent: DJPerformancePlan, outgoingBpm: number): number {
  const duration = intent.blend.duration;
  if ("bars" in duration && typeof duration.bars === "number") {
    return duration.bars * (60 / Math.max(40, outgoingBpm)) * 4;
  }
  if ("seconds" in duration && typeof duration.seconds === "number") {
    return duration.seconds;
  }
  return 0.1;
}

function resolveTempo(
  intent: DJPerformancePlan,
  fallback: TempoMatchResult,
  outgoingConfidence: number,
  incomingConfidence: number,
) {
  const reliable = outgoingConfidence >= 0.25 && incomingConfidence >= 0.25;
  const ignored = intent.tempo.mode === "match" && !reliable
    ? ["tempo_match_low_confidence"]
    : [];
  return {
    adjustment: intent.tempo.mode === "preserve" || !reliable ? preserveTempo() : fallback,
    maxAdjustmentPercent: intent.tempo.mode === "match" && reliable
      ? intent.tempo.maxAdjustmentPercent ?? 8
      : 0,
    ignored,
  };
}

export function compilePerformancePlan(
  intent: DJPerformancePlan,
  live: PerformanceLiveState,
): CompiledPerformancePlan {
  const fallback = createTransitionPlan({
    outgoingDeck: live.outgoingDeck,
    incomingDeck: live.incomingDeck,
    currentTimeSec: live.currentTimeSec,
    analysis: DEFAULT_ANALYSIS_SNAPSHOT,
  });
  const adjustments: string[] = [];
  const ignored: string[] = [];
  const accepted = ["energy_arc", "exit", "entry", "blend", "tempo"];
  const outgoingGrid = effectiveGrid(live.outgoingDeck);
  const incomingGrid = effectiveGrid(live.incomingDeck);
  const outgoingDuration = durationOf(live.outgoingDeck);
  const incomingDuration = durationOf(live.incomingDeck);
  const planningRunwaySec = Math.max(
    4,
    Math.min(8, (60 / Math.max(40, outgoingGrid.bpm)) * outgoingGrid.beatsPerBar * 2),
  );
  const safeRunwayTarget = Math.max(
    live.currentTimeSec + 0.25,
    Math.min(live.currentTimeSec + planningRunwaySec, outgoingDuration - 0.25),
  );
  const minExit = Math.max(safeRunwayTarget, intent.exit.notBeforeSec ?? 0);

  const resolvedExit = resolveExit(
    intent.exit,
    live.outgoingDeck,
    minExit,
    fallback.startBoundary.timeSec,
  );
  let exitSec = resolvedExit.exitSec;
  adjustments.push(...resolvedExit.adjustments);
  ignored.push(...resolvedExit.ignored);

  const resolvedEntry = resolveEntry(intent, live, exitSec);
  let entrySec = resolvedEntry.entrySec;
  accepted.push(...resolvedEntry.accepted);
  adjustments.push(...resolvedEntry.adjustments);
  ignored.push(...resolvedEntry.ignored);

  const requestedBlendSec = requestedBlendDurationSec(intent, outgoingGrid.bpm);
  const tempo = resolveTempo(
    intent,
    fallback.tempoAdjustment,
    outgoingGrid.confidence,
    incomingGrid.confidence,
  );
  let tempoAdjustment = tempo.adjustment;
  ignored.push(...tempo.ignored);
  const requiredIncomingDuration =
    requestedBlendSec + MIN_INCOMING_CONTINUITY_RUNWAY_SEC;
  if (incomingDuration < requiredIncomingDuration) {
    throw new RangeError(
      `Incoming track is not selectable: ${incomingDuration.toFixed(3)}s cannot cover ` +
        `${requestedBlendSec.toFixed(3)}s blend plus ` +
        `${MIN_INCOMING_CONTINUITY_RUNWAY_SEC}s continuity runway`,
    );
  }
  const mechanics = normalizeTransitionMechanics({
    requestedExitSec: exitSec,
    requestedEntrySec: entrySec,
    requestedBlendDurationSec: requestedBlendSec,
    targetPlaybackRate: tempoAdjustment.targetPlaybackRate,
    maxAdjustmentPercent: tempo.maxAdjustmentPercent,
    minimumExitSec: minExit,
    outgoingDurationSec: outgoingDuration,
    incomingDurationSec: incomingDuration,
    minimumIncomingRunwaySec:
      (MIN_INCOMING_CONTINUITY_RUNWAY_SEC + requestedBlendSec) /
      tempoAdjustment.targetPlaybackRate,
  });
  exitSec = mechanics.exitSec;
  entrySec = mechanics.entrySec;
  const crossfadeDurationSec = mechanics.blendDurationSec;
  tempoAdjustment = {
    ...tempoAdjustment,
    targetPlaybackRate: mechanics.playbackRate,
  };
  for (const adjustment of mechanics.adjustments) {
    if (!adjustments.includes(adjustment)) adjustments.push(adjustment);
  }

  const bassSwapAt = Math.max(0.2, Math.min(0.8, intent.blend.bassSwapAt ?? 0.5));
  if (bassSwapAt !== (intent.blend.bassSwapAt ?? 0.5)) adjustments.push("bass_swap_clamped");
  const eqPreset = EQ_PRESETS[intent.blend.eq];
  const eqCurve = getCurveByPreset(eqPreset, {
    durationSec: crossfadeDurationSec,
    bassSwapPoint: bassSwapAt,
  });

  let loop;
  if (intent.loop) {
    accepted.push("loop");
    const loopDeck = intent.loop.deck === "outgoing" ? live.outgoingDeck : live.incomingDeck;
    const loopGrid = effectiveGrid(loopDeck);
    const loopDurationSec = intent.loop.bars * (60 / loopGrid.bpm) * loopGrid.beatsPerBar;
    const loopEndSec = intent.loop.deck === "outgoing" ? exitSec : entrySec + loopDurationSec;
    loop = {
      deck: intent.loop.deck,
      startSec: Math.max(0, loopEndSec - loopDurationSec),
      endSec: Math.min(durationOf(loopDeck) - 0.1, loopEndSec),
      durationSec: loopDurationSec,
      repetitions: intent.loop.repetitions,
    };
  }

  const confidence = Math.max(
    0,
    Math.min(1, (outgoingGrid.confidence + incomingGrid.confidence) / 2),
  );
  const performance = {
    source: "agent" as const,
    energyArc: intent.energyArc,
    incomingStartSec: entrySec,
    crossfaderCurve: intent.blend.crossfaderCurve,
    eqPreset,
    bassSwapAt,
    loop,
    reason: intent.reason,
  };

  return {
    plan: {
      ...fallback,
      startBoundary: {
        ...fallback.startBoundary,
        timeSec: exitSec,
        isPhraseBoundary: true,
      },
      crossfadeDurationSec,
      tempoAdjustment,
      eqCurve,
      performance,
    },
    performance,
    diagnostics: {
      accepted,
      adjustments,
      ignored,
      fallbackReasons: [...ignored],
      confidence,
    },
  };
}
