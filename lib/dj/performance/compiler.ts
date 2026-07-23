import { getCurveByPreset } from "../eq/curves";
import { createTransitionPlan } from "../engine/transitionPlanner";
import { DEFAULT_ANALYSIS_SNAPSHOT } from "../engine/types";
import { getNextPhraseBoundary } from "../tempo/beatgrid";
import { scoreSegmentPair } from "../segments/scoring";
import type { TempoMatchResult } from "../types";
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

  let requestedExit: number | null = null;
  if (intent.exit.anchor === "mix_out") requestedExit = live.outgoingDeck.cuePoints?.mixOutSec ?? null;
  if (intent.exit.anchor === "time") requestedExit = intent.exit.timeSec;
  if (intent.exit.anchor === "section") {
    requestedExit = resolveSectionTime(live.outgoingDeck, intent.exit.section, minExit);
  }
  if (intent.exit.anchor === "next_phrase") requestedExit = minExit;
  if (requestedExit === null) {
    requestedExit = fallback.startBoundary.timeSec;
    ignored.push("exit_anchor_unavailable");
  }

  let exitSec: number;
  if (requestedExit < minExit) {
    exitSec = getNextPhraseBoundary(outgoingGrid, minExit - 0.01, 4);
    adjustments.push("exit_moved_to_next_phrase");
  } else {
    exitSec = getNextPhraseBoundary(outgoingGrid, requestedExit - 0.01, 4);
  }
  const boundedExitSec = Math.max(minExit, Math.min(outgoingDuration - 0.25, exitSec));
  if (boundedExitSec !== exitSec) adjustments.push("exit_clamped_to_runway");
  exitSec = boundedExitSec;

  let entrySec = 0;
  if (intent.entry.anchor === "mix_in") {
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
    if (rankedEntry) {
      entrySec = rankedEntry.segment.startSec;
      accepted.push("segment_pair");
    } else {
      entrySec = live.incomingDeck.cuePoints?.mixInSec ?? 0;
      ignored.push("segment_pair_unavailable");
    }
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
  entrySec = Math.max(0, Math.min(incomingDuration - 0.1, entrySec));

  const barDurationSec = (60 / Math.max(40, outgoingGrid.bpm)) * outgoingGrid.beatsPerBar;
  const blendDuration = intent.blend.duration;
  const requestedBlendSec =
    "bars" in blendDuration && typeof blendDuration.bars === "number"
      ? blendDuration.bars * barDurationSec
      : "seconds" in blendDuration && typeof blendDuration.seconds === "number"
        ? blendDuration.seconds
        : 0.1;
  const latestContinuitySafeEntry = Math.max(
    0,
    incomingDuration - requestedBlendSec - MIN_INCOMING_CONTINUITY_RUNWAY_SEC,
  );
  if (entrySec > latestContinuitySafeEntry) {
    entrySec = latestContinuitySafeEntry;
    adjustments.push("entry_clamped_for_continuity_runway");
  }
  const maxRunway = Math.max(
    0.1,
    Math.min(32, outgoingDuration - minExit, incomingDuration - entrySec),
  );
  const crossfadeDurationSec = Math.max(0.1, Math.min(requestedBlendSec, maxRunway));
  if (Math.abs(crossfadeDurationSec - requestedBlendSec) > 0.001) {
    adjustments.push("blend_clamped_to_runway");
  }
  const latestSafeExit = Math.max(minExit, outgoingDuration - crossfadeDurationSec);
  if (exitSec > latestSafeExit) {
    exitSec = latestSafeExit;
    if (!adjustments.includes("exit_clamped_to_runway")) {
      adjustments.push("exit_clamped_to_runway");
    }
  }

  const maxPercent = Math.max(0, Math.min(8, intent.tempo.maxAdjustmentPercent ?? 8));
  const tempoReliable = outgoingGrid.confidence >= 0.25 && incomingGrid.confidence >= 0.25;
  let tempoAdjustment =
    intent.tempo.mode === "preserve" || !tempoReliable
      ? preserveTempo()
      : fallback.tempoAdjustment;
  if (intent.tempo.mode === "match" && !tempoReliable) {
    ignored.push("tempo_match_low_confidence");
  }
  if (intent.tempo.mode === "match" && tempoReliable) {
    const minRate = 1 - maxPercent / 100;
    const maxRate = 1 + maxPercent / 100;
    const clampedRate = Math.max(minRate, Math.min(maxRate, tempoAdjustment.targetPlaybackRate));
    if (clampedRate !== tempoAdjustment.targetPlaybackRate) adjustments.push("tempo_clamped");
    tempoAdjustment = { ...tempoAdjustment, targetPlaybackRate: clampedRate };
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
