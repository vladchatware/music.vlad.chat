"use client";

import { useEffect, type MutableRefObject } from "react";

import { CoordinateMapper_Data } from "@/lib/mappers/coordinateMappers/data";
import FFTAnalyzer from "@/lib/analyzers/ftt";
import { BPMDetector } from "@/lib/analyzers/bpm-detector";

export function useAudioAnalysis(opts: {
  analyzerRef: MutableRefObject<FFTAnalyzer | null>;
  bpmDetectorRef: MutableRefObject<BPMDetector | null>;
  coordinateMapper: CoordinateMapper_Data;
  audioEnergyRef: MutableRefObject<number>;
  waitingForBeatRef: MutableRefObject<boolean>;
  nextTrackReadyRef: MutableRefObject<boolean>;
  crossfadeInProgressRef: MutableRefObject<boolean>;
  trackEndedWhileCueingRef: MutableRefObject<boolean>;
  onCrossfadeRequested: (opts?: { wasTrackEnded?: boolean }) => Promise<void> | void;
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
    onCrossfadeRequested,
  } = opts;

  useEffect(() => {
    let rafId: number | null = null;

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

      const shouldTransitionOnBeat = isHighEnergy;
      const shouldTransitionOnStill = isSignificantStill;

      const shouldSwitch =
        waitingForBeatRef.current &&
        nextTrackReadyRef.current &&
        !crossfadeInProgressRef.current &&
        (dropDetected ||
          shouldTransitionOnBeat ||
          shouldTransitionOnStill ||
          trackEndedWhileCueingRef.current);

      if (shouldSwitch) {
        void onCrossfadeRequested({
          wasTrackEnded: trackEndedWhileCueingRef.current,
        });
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
    onCrossfadeRequested,
  ]);
}

