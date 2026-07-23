"use client";

import { useCallback, useRef } from "react";
import { playbackDebug } from "@/lib/playbackDebug";
import { classifyExecutedEnergyArc } from "./continuityMetrics";

import type {
  EngineDiagnostics,
  PendingTransitionMetric,
  TransitionCompletionSample,
  TransitionMetric,
  TransitionOutcome,
} from "./runtimeModel";

export function useEngineDiagnostics() {
  const diagnosticsRef = useRef<EngineDiagnostics>({
    transitionStartFailures: 0,
    transitionAborts: 0,
    plannedTimeoutReplans: 0,
    earlyCutoffsCount: 0,
    totalTransitions: 0,
    abruptTransitions: 0,
    transitionMetrics: [],
    uninterruptedSegmentsSec: [],
    currentSegmentStartMs: null,
  });
  const pendingTransitionMetricRef = useRef<PendingTransitionMetric | null>(null);

  const finalizeCurrentListeningSegment = useCallback((atMs: number) => {
    const startedAt = diagnosticsRef.current.currentSegmentStartMs;
    if (startedAt === null) return;
    const durationSec = Math.max(0, (atMs - startedAt) / 1000);
    diagnosticsRef.current.uninterruptedSegmentsSec.push(durationSec);
    playbackDebug("engine.listening.segment", { durationSec });
    diagnosticsRef.current.currentSegmentStartMs = null;
  }, []);

  const ensureListeningSegment = useCallback((atMs: number) => {
    diagnosticsRef.current.currentSegmentStartMs ??= atMs;
  }, []);

  const recordTransitionOutcome = useCallback((
    outcome: TransitionOutcome,
    completionSample?: TransitionCompletionSample,
  ) => {
    const pending = pendingTransitionMetricRef.current;
    if (!pending) return;
    const hasCompletionSample =
      outcome === "completed" && completionSample !== undefined;
    const outgoingEnergyAtEnd = hasCompletionSample
      ? completionSample.outgoingEnergyAtEnd
      : null;
    const incomingEnergyAtEnd = hasCompletionSample
      ? completionSample.incomingEnergyAtEnd
      : null;
    const executedEnergyArc = incomingEnergyAtEnd === null
      ? null
      : classifyExecutedEnergyArc({
          outgoingEnergyAtStart: pending.outgoingEnergyAtStart,
          incomingEnergyAtEnd,
        });
    const metric: TransitionMetric = {
      ...pending,
      outgoingEnergyAtEnd,
      incomingEnergyAtEnd,
      incomingEnergyRise: incomingEnergyAtEnd === null
        ? null
        : incomingEnergyAtEnd - pending.incomingEnergyAtStart,
      executedEnergyDelta: incomingEnergyAtEnd === null
        ? null
        : incomingEnergyAtEnd - pending.outgoingEnergyAtStart,
      executedEnergyArc,
      arcContradiction:
        executedEnergyArc === null || pending.energyArc === null || pending.energyArc === "reset"
          ? null
          : pending.energyArc !== executedEnergyArc,
      transitionOutcome: outcome,
      atMs: performance.now(),
    };
    const diagnostics = diagnosticsRef.current;
    diagnostics.transitionMetrics.push(metric);
    if (diagnostics.transitionMetrics.length > 200) diagnostics.transitionMetrics.shift();
    diagnostics.totalTransitions += 1;
    if (metric.isAbruptTransition) diagnostics.abruptTransitions += 1;
    playbackDebug("engine.transition.outcome", metric);
    pendingTransitionMetricRef.current = null;
  }, []);

  return {
    diagnosticsRef,
    pendingTransitionMetricRef,
    finalizeCurrentListeningSegment,
    ensureListeningSegment,
    recordTransitionOutcome,
  };
}
