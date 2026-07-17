"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getCrossfaderGains,
  projectTransitionClock,
  type TransitionSuggestion,
} from "@/lib/dj";
import styles from "../../../backroom.module.css";
import EnergyTimeline, { type TimelineSegment, type TrackSection } from "./EnergyTimeline";

export type MixDeckTrack = {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  samples: number[];
  sections: TrackSection[];
  segments: TimelineSegment[];
};

type Props = {
  outgoing: MixDeckTrack;
  incoming: MixDeckTrack;
  suggestions: TransitionSuggestion[];
  energyArc: "preserve" | "build" | "release" | "reset";
};

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const seekMedia = (audio: HTMLAudioElement, seconds: number) => {
  if (
    audio.readyState >= HTMLMediaElement.HAVE_METADATA &&
    !audio.seeking &&
    Math.abs(audio.currentTime - seconds) < 0.04
  ) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("error", onError);
    };
    const finish = (cause?: Error) => {
      cleanup();
      cause ? reject(cause) : resolve();
    };
    const onSeeked = () => finish();
    const onError = () => finish(new Error("Deck audio unavailable"));
    const timeout = window.setTimeout(() => finish(new Error("Deck seek timed out")), 8000);
    audio.addEventListener("seeked", onSeeked, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.currentTime = seconds;
  });
};

export default function MixDeck({ outgoing, incoming, suggestions, energyArc }: Props) {
  const outgoingAudioRef = useRef<HTMLAudioElement>(null);
  const incomingAudioRef = useRef<HTMLAudioElement>(null);
  const frameRef = useRef(0);
  const generationRef = useRef(0);
  const [selectedId, setSelectedId] = useState(suggestions[0]?.id ?? "");
  const selected = suggestions.find(({ id }) => id === selectedId) ?? suggestions[0];
  const [outgoingTime, setOutgoingTime] = useState(selected?.outgoing.startSec ?? 0);
  const [incomingTime, setIncomingTime] = useState(selected?.incoming.startSec ?? 0);
  const [status, setStatus] = useState<"idle" | "loading" | "mixing" | "continuing">("idle");
  const [mixProgress, setMixProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    generationRef.current += 1;
    cancelAnimationFrame(frameRef.current);
    for (const audio of [outgoingAudioRef.current, incomingAudioRef.current]) {
      if (!audio) continue;
      audio.pause();
      audio.volume = 1;
      audio.playbackRate = 1;
    }
    setStatus("idle");
    setMixProgress(0);
  }, []);

  const snapToSuggestion = useCallback((suggestion: TransitionSuggestion) => {
    setOutgoingTime(suggestion.outgoing.startSec);
    setIncomingTime(suggestion.incoming.startSec);
    if (outgoingAudioRef.current?.readyState) outgoingAudioRef.current.currentTime = suggestion.outgoing.startSec;
    if (incomingAudioRef.current?.readyState) incomingAudioRef.current.currentTime = suggestion.incoming.startSec;
  }, []);

  useEffect(() => {
    const next = suggestions[0];
    stop();
    setSelectedId(next?.id ?? "");
    if (next) snapToSuggestion(next);
  }, [incoming.id, suggestions, snapToSuggestion, stop]);

  useEffect(() => () => stop(), [stop]);

  const chooseSuggestion = (suggestion: TransitionSuggestion) => {
    stop();
    setSelectedId(suggestion.id);
    snapToSuggestion(suggestion);
  };

  const seek = (deck: "outgoing" | "incoming", seconds: number) => {
    const audio = deck === "outgoing" ? outgoingAudioRef.current : incomingAudioRef.current;
    if (audio) audio.currentTime = seconds;
    deck === "outgoing" ? setOutgoingTime(seconds) : setIncomingTime(seconds);
  };

  const playTransition = async () => {
    if (!selected) return;
    if (status !== "idle") {
      stop();
      return;
    }
    const outgoingAudio = outgoingAudioRef.current;
    const incomingAudio = incomingAudioRef.current;
    if (!outgoingAudio || !incomingAudio) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setError(null);
    setStatus("loading");
    try {
      outgoingAudio.playbackRate = 1;
      incomingAudio.playbackRate = selected.incomingPlaybackRate;
      outgoingAudio.preservesPitch = true;
      incomingAudio.preservesPitch = true;
      outgoingAudio.volume = 0;
      incomingAudio.volume = 0;
      if (outgoingAudio.readyState >= HTMLMediaElement.HAVE_METADATA) outgoingAudio.currentTime = selected.outgoing.startSec;
      if (incomingAudio.readyState >= HTMLMediaElement.HAVE_METADATA) incomingAudio.currentTime = selected.incoming.startSec;
      const playback = Promise.all([outgoingAudio.play(), incomingAudio.play()]);
      await playback;
      if (generationRef.current !== generation) return;
      await Promise.all([
        seekMedia(outgoingAudio, selected.outgoing.startSec),
        seekMedia(incomingAudio, selected.incoming.startSec),
      ]);
      if (generationRef.current !== generation) return;
      outgoingAudio.volume = 1;
      setOutgoingTime(selected.outgoing.startSec);
      setIncomingTime(selected.incoming.startSec);
      setStatus("mixing");
      const startedAt = performance.now();
      let lastPaint = 0;
      const continueIncoming = () => {
        if (generationRef.current !== generation) return;
        if (incomingAudio.ended) {
          stop();
          return;
        }
        setIncomingTime(incomingAudio.currentTime);
        frameRef.current = requestAnimationFrame(continueIncoming);
      };
      const tick = (now: number) => {
        if (generationRef.current !== generation) return;
        const position = projectTransitionClock({
          outgoingStartSec: selected.outgoing.startSec,
          incomingStartSec: selected.incoming.startSec,
          incomingPlaybackRate: selected.incomingPlaybackRate,
          durationSec: selected.wallDurationSec,
          elapsedSec: (now - startedAt) / 1000,
        });
        const gains = getCrossfaderGains("equal_power", position.progress);
        outgoingAudio.volume = gains.outgoing;
        incomingAudio.volume = gains.incoming;
        if (now - lastPaint >= 40 || position.progress === 1) {
          setOutgoingTime(position.outgoingSec);
          setIncomingTime(position.incomingSec);
          setMixProgress(position.progress);
          lastPaint = now;
        }
        if (position.progress >= 1) {
          outgoingAudio.volume = 0;
          outgoingAudio.pause();
          incomingAudio.volume = 1;
          setStatus("continuing");
          frameRef.current = requestAnimationFrame(continueIncoming);
          return;
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (cause) {
      stop();
      setError(cause instanceof Error ? cause.message : "Preview unavailable");
    }
  };

  if (!selected) return <div className={styles.mixUnavailable}><b>NO SAFE WINDOW</b><p>No playable transition window for this pair.</p></div>;

  return <div className={styles.dualDeck} style={{ "--mix-progress": mixProgress } as React.CSSProperties}>
    <div className={styles.deckTransport}>
      <button type="button" onClick={playTransition} aria-label={status === "idle" ? "Play transition" : status === "continuing" ? "Stop incoming track" : "Stop transition"}>
        <i aria-hidden="true" />
        {status === "loading" ? "Loading decks…" : status === "mixing" ? "■ Stop transition" : status === "continuing" ? "■ Stop incoming" : "▶ Play transition"}
      </button>
      <div><small>BLEND</small><strong>{selected.wallDurationSec.toFixed(1)}s</strong></div>
      <div><small>TEMPO</small><strong>{((selected.incomingPlaybackRate - 1) * 100).toFixed(1)}%</strong></div>
      <div><small>SCORE</small><strong>{Math.round(selected.score * 100)}</strong></div>
      <span>{error ?? (status === "continuing" ? "Incoming deck continuing · stop when resolved" : `${selected.reasons.join(" · ")} · ${energyArc}`)}</span>
    </div>

    <section className={styles.deckLane} data-deck="outgoing">
      <header><b>OUT</b><div><small>{outgoing.artist}</small><h3>{outgoing.title}</h3></div><output>{formatTime(outgoingTime)} <span>/ {formatTime(outgoing.durationSec)}</span></output></header>
      <EnergyTimeline durationSec={outgoing.durationSec} samples={outgoing.samples} sections={outgoing.sections} segments={outgoing.segments} currentTime={outgoingTime} onSeek={(seconds) => seek("outgoing", seconds)} ariaLabel={`${outgoing.title} energy`} highlightedWindow={selected.outgoing} deck="outgoing" />
    </section>

    <section className={styles.deckLane} data-deck="incoming">
      <header><b>IN</b><div><small>{incoming.artist}</small><h3>{incoming.title}</h3></div><output>{formatTime(incomingTime)} <span>/ {formatTime(incoming.durationSec)}</span></output></header>
      <EnergyTimeline durationSec={incoming.durationSec} samples={incoming.samples} sections={incoming.sections} segments={incoming.segments} currentTime={incomingTime} onSeek={(seconds) => seek("incoming", seconds)} ariaLabel={`${incoming.title} energy`} highlightedWindow={selected.incoming} deck="incoming" />
    </section>

    <div className={styles.deckWindows} aria-label="Transition windows">
      {suggestions.map((suggestion, index) => <button key={suggestion.id} type="button" aria-pressed={suggestion.id === selected.id} onClick={() => chooseSuggestion(suggestion)}>
        <b>0{index + 1}</b>
        <span>OUT {formatTime(suggestion.outgoing.startSec)}–{formatTime(suggestion.outgoing.endSec)}</span>
        <span>IN {formatTime(suggestion.incoming.startSec)}–{formatTime(suggestion.incoming.endSec)}</span>
        <strong>{Math.round(suggestion.score * 100)}</strong>
      </button>)}
    </div>

    <audio ref={outgoingAudioRef} src={`/api/tracks/${outgoing.id}/stream`} preload="metadata" onLoadedMetadata={(event) => { event.currentTarget.currentTime = selected.outgoing.startSec; }} />
    <audio ref={incomingAudioRef} src={`/api/tracks/${incoming.id}/stream`} preload="metadata" onLoadedMetadata={(event) => { event.currentTarget.currentTime = selected.incoming.startSec; }} onEnded={stop} />
  </div>;
}
