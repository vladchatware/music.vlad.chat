"use client";

import { useCallback, useRef } from "react";
import { playbackDebug } from "@/lib/playbackDebug";

import type {
  EngineDiagnostics,
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
  const pendingTransitionMetricRef = useRef<{
    handoffEnergyMismatch: number;
    isAbruptTransition: boolean;
  } | null>(null);

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

  const recordTransitionOutcome = useCallback((outcome: TransitionOutcome) => {
    const pending = pendingTransitionMetricRef.current;
    if (!pending) return;
    const metric: TransitionMetric = {
      ...pending,
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
