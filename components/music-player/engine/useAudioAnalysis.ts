"use client";

import { useEffect, type MutableRefObject } from "react";

import { CoordinateMapper_Data } from "@/lib/mappers/coordinateMappers/data";
import FFTAnalyzer from "@/lib/analyzers/ftt";
import { BPMDetector } from "@/lib/analyzers/bpm-detector";
import { type TrackSection, useMusicPlayerStore } from "../store/useMusicPlayerStore";

function classifySection(opts: {
  overallAvg: number;
  bassAvg: number;
  overallSlope: number;
  bassSlope: number;
  isStill: boolean;
}): TrackSection {
  const { overallAvg, bassAvg, overallSlope, bassSlope, isStill } = opts;

  if (isStill) return "breakdown";

  const avg = (overallAvg + bassAvg) / 2;
  const slope = (overallSlope + bassSlope) / 2;

  if (avg < 0.18 && Math.abs(slope) < 0.01) return "intro";
  if (slope > 0.01 && avg < 0.6) return "comeup";
  if (avg > 0.55 && slope >= -0.01) return "culmination";
  if (avg < 0.28 && slope < -0.01) return "breakdown";
  return "unknown";
}

export function useAudioAnalysis(opts: {
  analyzerRef: MutableRefObject<FFTAnalyzer | null>;
  bpmDetectorRef: MutableRefObject<BPMDetector | null>;
  coordinateMapper: CoordinateMapper_Data;
  audioEnergyRef: MutableRefObject<number>;
  waitingForBeatRef: MutableRefObject<boolean>;
  nextTrackReadyRef: MutableRefObject<boolean>;
  crossfadeInProgressRef: MutableRefObject<boolean>;
  trackEndedWhileCueingRef: MutableRefObject<boolean>;
}) {
  const {
    analyzerRef,
    bpmDetectorRef,
    coordinateMapper,
    audioEnergyRef,
    waitingForBeatRef,
    nextTrackReadyRef,
    crossfadeInProgressRef,
    trackEndedWhileCueingRef,
  } = opts;

  useEffect(() => {
    let rafId: number | null = null;

    const windowMs = 15000;
    const historyRef = {
      current: [] as Array<{ t: number; overall: number; bass: number }>,
    };
    const lastSectionRef = { current: "unknown" as TrackSection };
    const lastPublishRef = { current: 0 };

    const tick = () => {
      const analyzer = analyzerRef.current;
      if (!analyzer) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const bars = analyzer.getBars();
      if (coordinateMapper.data.length !== bars.length) {
        const amplitude = coordinateMapper.amplitude;
        const next = new CoordinateMapper_Data({ amplitude, size: bars.length });
        (coordinateMapper as any)._params = next.params;
        (coordinateMapper as any).data = next.data;
      }
      for (let i = 0; i < bars.length; i++) {
        coordinateMapper.data[i] = bars[i].value;
      }

      audioEnergyRef.current = analyzer.getEnergy();

      const bassEnergy = analyzer.getEnergy("bass");
      const dropDetected = bpmDetectorRef.current?.detectBeat(bassEnergy) || false;

      const isHighEnergy = bassEnergy > 0.6;
      const stillDuration = bpmDetectorRef.current?.getCurrentStillDuration() || 0;
      const isSignificantStill = stillDuration > 500;
      const isStillNow = bpmDetectorRef.current?.isInStillPeriod() || false;

      const shouldTransitionOnBeat = isHighEnergy;
      const shouldTransitionOnStill = isSignificantStill;

      const transitionSignal =
        waitingForBeatRef.current &&
        nextTrackReadyRef.current &&
        !crossfadeInProgressRef.current &&
        (dropDetected ||
          shouldTransitionOnBeat ||
          shouldTransitionOnStill ||
          trackEndedWhileCueingRef.current);

      const transitionSignalReason:
        | "drop"
        | "highEnergy"
        | "still"
        | "trackEndedWhileCueing"
        | "none" = trackEndedWhileCueingRef.current
          ? "trackEndedWhileCueing"
          : dropDetected
            ? "drop"
            : shouldTransitionOnStill
              ? "still"
              : shouldTransitionOnBeat
                ? "highEnergy"
                : "none";

      // Section heuristics (rolling window slope over ~15s)
      const now = performance.now();
      historyRef.current.push({
        t: now,
        overall: audioEnergyRef.current,
        bass: bassEnergy,
      });
      while (historyRef.current.length && now - historyRef.current[0].t > windowMs) {
        historyRef.current.shift();
      }

      let overallAvg = 0;
      let bassAvg = 0;
      for (const p of historyRef.current) {
        overallAvg += p.overall;
        bassAvg += p.bass;
      }
      const n = Math.max(1, historyRef.current.length);
      overallAvg /= n;
      bassAvg /= n;

      const first = historyRef.current[0] ?? null;
      const last = historyRef.current[historyRef.current.length - 1] ?? null;
      const dt = first && last ? Math.max(1, last.t - first.t) : 1;
      const overallSlope = first && last ? (last.overall - first.overall) / (dt / 1000) : 0;
      const bassSlope = first && last ? (last.bass - first.bass) / (dt / 1000) : 0;

      const section = classifySection({
        overallAvg,
        bassAvg,
        overallSlope,
        bassSlope,
        isStill: isStillNow || isSignificantStill,
      });

      // Publish to store on every frame for smooth rhythmic visuals
      const actions = useMusicPlayerStore.getState().actions;
      actions.setAnalysis({
        overallEnergy: audioEnergyRef.current,
        bassEnergy,
        beatPhase: bpmDetectorRef.current?.getBeatPhase() || 0,
        bpm: bpmDetectorRef.current?.getBPM() || null,
        stillDurationMs: stillDuration,
        dropDetected,
        transitionSignal,
        transitionSignalReason,
        section,
        lastTransitionSignalAtMs: transitionSignal ? now : useMusicPlayerStore.getState().analysis.lastTransitionSignalAtMs,
      });

      if (section !== lastSectionRef.current) {
        lastSectionRef.current = section;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    analyzerRef,
    bpmDetectorRef,
    coordinateMapper,
    audioEnergyRef,
    waitingForBeatRef,
    nextTrackReadyRef,
    crossfadeInProgressRef,
    trackEndedWhileCueingRef,
  ]);
}

