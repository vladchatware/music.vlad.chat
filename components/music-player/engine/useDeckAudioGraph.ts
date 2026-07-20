"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import FFTAnalyzer from "@/lib/analyzers/ftt";
import { BPMDetector } from "@/lib/analyzers/bpm-detector";
import { EQController } from "@/lib/dj";
import type { DeckId, DeckStatus } from "./runtimeModel";
import { closeAudioContextSafely } from "./asyncSafety";

type EngineLogger = (event: string, payload?: Record<string, unknown>) => void;

export function useDeckAudioGraph(
  isIOS: boolean,
  activeDeckRef: MutableRefObject<DeckId>,
  logEngine: EngineLogger,
) {
  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerARef = useRef<FFTAnalyzer | null>(null);
  const analyzerBRef = useRef<FFTAnalyzer | null>(null);
  const analyzerRef = useRef<FFTAnalyzer | null>(null);
  const bpmDetectorRef = useRef<BPMDetector | null>(null);
  const eqControllerARef = useRef<EQController | null>(null);
  const eqControllerBRef = useRef<EQController | null>(null);
  const masterMixRef = useRef<GainNode | null>(null);
  const deckStatusRef = useRef<Record<DeckId, DeckStatus>>({
    A: { canPlay: false, metadataLoaded: false, isPlaying: false, lastError: null },
    B: { canPlay: false, metadataLoaded: false, isPlaying: false, lastError: null },
  });

  const getDeckElement = useCallback((deckId: DeckId): HTMLAudioElement | null => {
    return deckId === "A" ? deckARef.current : deckBRef.current;
  }, []);

  const getInactiveDeckId = useCallback((): DeckId => {
    return activeDeckRef.current === "A" ? "B" : "A";
  }, []);

  const getActiveDeckElement = useCallback((): HTMLAudioElement | null => {
    return getDeckElement(activeDeckRef.current);
  }, [getDeckElement]);

  const getActiveAnalyzer = useCallback((): FFTAnalyzer | null => {
    return activeDeckRef.current === "A" ? analyzerARef.current : analyzerBRef.current;
  }, []);

  const getInactiveAnalyzer = useCallback((): FFTAnalyzer | null => {
    return activeDeckRef.current === "A" ? analyzerBRef.current : analyzerARef.current;
  }, []);

  const getActiveEQ = useCallback((): EQController | null => {
    return activeDeckRef.current === "A" ? eqControllerARef.current : eqControllerBRef.current;
  }, []);

  const getInactiveEQ = useCallback((): EQController | null => {
    return activeDeckRef.current === "A" ? eqControllerBRef.current : eqControllerARef.current;
  }, []);

  const waitForDeckCanPlay = useCallback(
    async (deckId: DeckId, timeoutMs = 20_000) => {
      const deck = getDeckElement(deckId);
      if (!deck) throw new Error(`Deck ${deckId} is unavailable`);

      if (
        deckStatusRef.current[deckId].canPlay ||
        (deck.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && !!deck.src)
      ) {
        deckStatusRef.current[deckId].canPlay = true;
        logEngine("engine.deck.canplay.immediate", {
          deckId,
          readyState: deck.readyState,
          src: deck.currentSrc || deck.src,
        });
        return;
      }

      await new Promise<void>((resolve, reject) => {
        let done = false;
        const cleanup = () => {
          clearTimeout(timer);
          deck.removeEventListener("canplay", onCanPlay);
          deck.removeEventListener("error", onError);
        };
        const onCanPlay = () => {
          if (done) return;
          done = true;
          cleanup();
          deckStatusRef.current[deckId].canPlay = true;
          logEngine("engine.deck.canplay", {
            deckId,
            readyState: deck.readyState,
            src: deck.currentSrc || deck.src,
          });
          resolve();
        };
        const onError = () => {
          if (done) return;
          done = true;
          cleanup();
          const message = `Deck ${deckId} failed to load`;
          deckStatusRef.current[deckId].lastError = message;
          logEngine("engine.deck.canplay.error", {
            deckId,
            message,
            src: deck.currentSrc || deck.src,
          });
          reject(new Error(message));
        };
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          cleanup();
          logEngine("engine.deck.canplay.timeout", {
            deckId,
            timeoutMs,
            src: deck.currentSrc || deck.src,
          });
          reject(new Error(`Timed out waiting for deck ${deckId} canplay`));
        }, timeoutMs);

        deck.addEventListener("canplay", onCanPlay);
        deck.addEventListener("error", onError);
      });
    },
    [getDeckElement, logEngine],
  );

  useEffect(() => {
    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    if (!deckA || !deckB) return;

    deckA.crossOrigin = "anonymous";
    deckB.crossOrigin = "anonymous";

    if (!isIOS) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextCtor();
      audioContextRef.current = context;
      const sourceA = context.createMediaElementSource(deckA);
      const sourceB = context.createMediaElementSource(deckB);
      const eqA = new EQController(context);
      const eqB = new EQController(context);
      const masterMix = context.createGain();
      masterMix.gain.value = 1;

      eqA.connectSource(sourceA);
      eqB.connectSource(sourceB);
      eqA.connectDestination(masterMix);
      eqB.connectDestination(masterMix);
      masterMix.connect(context.destination);

      eqControllerARef.current = eqA;
      eqControllerBRef.current = eqB;
      masterMixRef.current = masterMix;
      analyzerARef.current = new FFTAnalyzer(sourceA, context, 0);
      analyzerBRef.current = new FFTAnalyzer(sourceB, context, 0);
      analyzerRef.current = new FFTAnalyzer(masterMix, context, 0);
      deckA.volume = 1;
      deckB.volume = 1;
    } else {
      deckA.volume = 1;
      deckB.volume = 0;
    }

    bpmDetectorRef.current = new BPMDetector();

    return () => {
      for (const analyzer of [analyzerARef.current, analyzerBRef.current, analyzerRef.current]) {
        analyzer?.toggleAnalyzer(false);
        analyzer?.disconnectInputs();
      }
      eqControllerARef.current?.dispose();
      eqControllerBRef.current?.dispose();
      masterMixRef.current?.disconnect();
      const context = audioContextRef.current;
      if (context) void closeAudioContextSafely(() => context.close());
      deckA.pause();
      deckB.pause();

      analyzerARef.current = null;
      analyzerBRef.current = null;
      analyzerRef.current = null;
      eqControllerARef.current = null;
      eqControllerBRef.current = null;
      masterMixRef.current = null;
      bpmDetectorRef.current = null;
      audioContextRef.current = null;
    };
  }, [isIOS]);

  return {
    deckARef,
    deckBRef,
    audioContextRef,
    analyzerARef,
    analyzerBRef,
    analyzerRef,
    bpmDetectorRef,
    eqControllerARef,
    eqControllerBRef,
    masterMixRef,
    activeDeckRef,
    deckStatusRef,
    getDeckElement,
    getInactiveDeckId,
    getActiveDeckElement,
    getActiveAnalyzer,
    getInactiveAnalyzer,
    getActiveEQ,
    getInactiveEQ,
    waitForDeckCanPlay,
  };
}

export type DeckAudioGraph = ReturnType<typeof useDeckAudioGraph>;
