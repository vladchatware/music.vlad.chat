"use client";

import { useEffect, type MutableRefObject } from "react";

import type FFTAnalyzer from "@/lib/analyzers/ftt";
import { CoordinateMapper_Data } from "@/lib/mappers/coordinateMappers/data";

export function useAudioVisualization(
  analyzerRef: MutableRefObject<FFTAnalyzer | null>,
  coordinateMapper: CoordinateMapper_Data,
): void {
  useEffect(() => {
    let rafId = 0;
    const render = () => {
      const bars = analyzerRef.current?.getBars() ?? [];
      coordinateMapper.resize(bars.length);
      for (let index = 0; index < bars.length; index += 1) {
        coordinateMapper.data[index] = bars[index].value;
      }
      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [analyzerRef, coordinateMapper]);
}
