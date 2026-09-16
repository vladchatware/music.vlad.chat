"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import FFTAnalyzer from "@/lib/analyzers/ftt";
import { BPMDetector } from "@/lib/analyzers/bpm-detector";
import { getEQAtProgress, type EQBand, type EQCurve } from "@/lib/dj";
import { SuperpoweredAudioEngine } from "../audio-engine/superpoweredEngine";
import type { DeckPlaybackState } from "../audio-engine/types";
import type { DeckId, DeckStatus } from "./runtimeModel";

type EngineLogger = (event: string, payload?: Record<string, unknown>) => void;

export type DeckEQControl = {
  setCurve(curve: EQCurve | null): void;
  tick(progress: number, isOutgoing: boolean): void;
  reset(): void;
};

function createEQControl(
  engine: SuperpoweredAudioEngine,
  deck: DeckId,
): DeckEQControl {
  let curve: EQCurve | null = null;
  const flat: EQBand = { low: 1, mid: 1, high: 1 };
  return {
    setCurve(nextCurve) {
      curve = nextCurve;
    },
    tick(progress, isOutgoing) {
      if (!curve) return;
      const keyframes = isOutgoing ? curve.outgoing : curve.incoming;
      engine.setEQ(deck, getEQAtProgress(keyframes, progress));
    },
    reset() {
      curve = null;
      engine.setEQ(deck, flat);
    },
  };
}

export function useDeckAudioGraph(
  _isIOS: boolean,
  activeDeckRef: MutableRefObject<DeckId>,
  logEngine: EngineLogger,
) {
  const engineRef = useRef(new SuperpoweredAudioEngine());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerARef = useRef<FFTAnalyzer | null>(null);
  const analyzerBRef = useRef<FFTAnalyzer | null>(null);
  const analyzerRef = useRef<FFTAnalyzer | null>(null);
  const bpmDetectorRef = useRef<BPMDetector | null>(new BPMDetector());
  const eqControllerARef = useRef<DeckEQControl>(
    createEQControl(engineRef.current, "A"),
  );
  const eqControllerBRef = useRef<DeckEQControl>(
    createEQControl(engineRef.current, "B"),
  );
  const broadcastAudioStreamRef = useRef<MediaStream | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const [audioReady, setAudioReady] = useState(false);
  const deckStatusRef = useRef<Record<DeckId, DeckStatus>>({
    A: { canPlay: false, metadataLoaded: false, isPlaying: false, lastError: null },
    B: { canPlay: false, metadataLoaded: false, isPlaying: false, lastError: null },
  });

  const getDeckState = useCallback(
    (deckId: DeckId): DeckPlaybackState => engineRef.current.getDeckState(deckId),
    [],
  );

  const getInactiveDeckId = useCallback((): DeckId => {
    return activeDeckRef.current === "A" ? "B" : "A";
  }, []);

  const getActiveDeckState = useCallback((): DeckPlaybackState => {
    return getDeckState(activeDeckRef.current);
  }, [getDeckState]);

  const getActiveAnalyzer = useCallback((): FFTAnalyzer | null => {
    return activeDeckRef.current === "A" ? analyzerARef.current : analyzerBRef.current;
  }, []);

  const getInactiveAnalyzer = useCallback((): FFTAnalyzer | null => {
    return activeDeckRef.current === "A" ? analyzerBRef.current : analyzerARef.current;
  }, []);

  const getActiveEQ = useCallback((): DeckEQControl => {
    return activeDeckRef.current === "A"
      ? eqControllerARef.current
      : eqControllerBRef.current;
  }, []);

  const getInactiveEQ = useCallback((): DeckEQControl => {
    return activeDeckRef.current === "A"
      ? eqControllerBRef.current
      : eqControllerARef.current;
  }, []);

  const waitForDeckCanPlay = useCallback(async (deckId: DeckId) => {
    if (!engineRef.current.getDeckState(deckId).loaded) {
      throw new Error(`Deck ${deckId} is not loaded`);
    }
  }, []);

  useEffect(() => {
    const generation = ++lifecycleGenerationRef.current;
    let cancelled = false;
    const engine = engineRef.current;

    void engine.initialize().then(() => {
      if (cancelled) return;
      const context = engine.context;
      const output = engine.outputNode;
      const deckAOutput = engine.deckOutputNodes.A;
      const deckBOutput = engine.deckOutputNodes.B;
      if (!context || !output || !deckAOutput || !deckBOutput) return;

      audioContextRef.current = context;
      broadcastAudioStreamRef.current = engine.broadcastStream;
      setAudioReady(true);
      analyzerARef.current = new FFTAnalyzer(deckAOutput, context, 0);
      analyzerBRef.current = new FFTAnalyzer(deckBOutput, context, 0);
      analyzerRef.current = new FFTAnalyzer(output, context, 0);
      logEngine("engine.superpowered.ready", {
        sampleRate: context.sampleRate,
        baseLatencySec: context.baseLatency,
        outputLatencySec:
          "outputLatency" in context ? context.outputLatency : null,
      });
    }).catch((error) => {
      logEngine("engine.superpowered.initialization_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    const unsubscribe = engine.subscribe((event) => {
      if (event.type === "state") {
        for (const deck of ["A", "B"] as const) {
          const state = event.decks[deck];
          deckStatusRef.current[deck] = {
            canPlay: state.loaded,
            metadataLoaded: state.loaded,
            isPlaying: state.playing,
            lastError: null,
          };
        }
      } else if (event.type === "deck-error") {
        deckStatusRef.current[event.deck].lastError = event.message;
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      queueMicrotask(() => {
        if (lifecycleGenerationRef.current !== generation) return;
        for (const analyzer of [
          analyzerARef.current,
          analyzerBRef.current,
          analyzerRef.current,
        ]) {
          analyzer?.toggleAnalyzer(false);
          analyzer?.disconnectInputs();
        }
        void engine.dispose();
      });
    };
  }, [logEngine]);

  return {
    engineRef,
    audioReady,
    audioContextRef,
    analyzerARef,
    analyzerBRef,
    analyzerRef,
    bpmDetectorRef,
    eqControllerARef,
    eqControllerBRef,
    broadcastAudioStreamRef,
    activeDeckRef,
    deckStatusRef,
    getDeckState,
    getInactiveDeckId,
    getActiveDeckState,
    getActiveAnalyzer,
    getInactiveAnalyzer,
    getActiveEQ,
    getInactiveEQ,
    waitForDeckCanPlay,
  };
}

export type DeckAudioGraph = ReturnType<typeof useDeckAudioGraph>;
