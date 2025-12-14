"use client";

import { type MutableRefObject } from "react";
import FFTAnalyzer from "@/lib/analyzers/ftt";

export type CueingResult =
  | { kind: "beat"; cueTimeSec: number }
  | { kind: "still"; cueTimeSec: number; stillDurationMs: number }
  | { kind: "timeout"; cueTimeSec: number };

export async function cueTrackOnDeck(opts: {
  targetDeck: HTMLAudioElement;
  cueAnalyzer: FFTAnalyzer | null;
  connectAnalyzerInput?: (analyzer: FFTAnalyzer) => void;
  setLoading: (loading: boolean) => void;
  waitingForBeatRef: MutableRefObject<boolean>;
  nextTrackReadyRef: MutableRefObject<boolean>;
  maxCueTimeMs?: number;
}): Promise<CueingResult | null> {
  const {
    targetDeck,
    cueAnalyzer,
    connectAnalyzerInput,
    setLoading,
    waitingForBeatRef,
    nextTrackReadyRef,
  } = opts;

  const maxCueTimeMs = opts.maxCueTimeMs ?? 60000;

  targetDeck.muted = true;

  // Randomize start position to avoid always catching intros
  const duration = targetDeck.duration || 180;
  const minStart = Math.min(15, duration * 0.1);
  const maxStart = Math.min(duration * 0.5, duration - 60);
  const randomStart = minStart + Math.random() * Math.max(0, maxStart - minStart);
  targetDeck.currentTime = randomStart;

  // Try to play for cueing - may fail on iOS Safari without user gesture
  try {
    await targetDeck.play();
  } catch (e) {
    // iOS autoplay restriction fallback
    targetDeck.muted = false;
    nextTrackReadyRef.current = true;
    waitingForBeatRef.current = false;
    setLoading(false);
    return null;
  }

  if (cueAnalyzer && connectAnalyzerInput) connectAnalyzerInput(cueAnalyzer);

  const startTime = performance.now();
  let lastLogTime = 0;

  let currentStillStart: number | null = null;
  let currentStillAudioTime = 0;
  const stillThreshold = 0.2;
  const minStillDuration = 500;
  const beatThreshold = 0.6;

  return await new Promise((resolve) => {
    const checkCuePoint = () => {
      if (!waitingForBeatRef.current) {
        try {
          targetDeck.pause();
        } catch {}
        resolve(null);
        return;
      }

      const elapsed = performance.now() - startTime;
      const bassEnergy = cueAnalyzer?.getEnergy("bass") || 0;

      if (bassEnergy < stillThreshold) {
        if (currentStillStart === null) {
          currentStillStart = performance.now();
          currentStillAudioTime = targetDeck.currentTime;
        }
        const stillDuration = performance.now() - currentStillStart;
        if (stillDuration >= minStillDuration) {
          targetDeck.pause();
          targetDeck.currentTime = currentStillAudioTime;
          targetDeck.muted = false;
          nextTrackReadyRef.current = true;
          setLoading(false);
          resolve({
            kind: "still",
            cueTimeSec: currentStillAudioTime,
            stillDurationMs: stillDuration,
          });
          return;
        }
      } else {
        currentStillStart = null;
        if (bassEnergy > beatThreshold) {
          const cueTime = Math.max(0, targetDeck.currentTime - 0.05);
          targetDeck.pause();
          targetDeck.currentTime = cueTime;
          targetDeck.muted = false;
          nextTrackReadyRef.current = true;
          setLoading(false);
          resolve({ kind: "beat", cueTimeSec: cueTime });
          return;
        }
      }

      if (elapsed - lastLogTime > 2000) {
        lastLogTime = elapsed;
      }

      if (elapsed > maxCueTimeMs) {
        targetDeck.pause();
        targetDeck.currentTime = 0;
        targetDeck.muted = false;
        nextTrackReadyRef.current = true;
        setLoading(false);
        resolve({ kind: "timeout", cueTimeSec: 0 });
        return;
      }

      requestAnimationFrame(checkCuePoint);
    };

    requestAnimationFrame(checkCuePoint);
  });
}

