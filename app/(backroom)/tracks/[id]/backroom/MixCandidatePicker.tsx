"use client";

import { useMemo, useRef, useState } from "react";

import type { TransitionSuggestion } from "@/lib/dj";
import styles from "../../../backroom.module.css";
import MixDeck, { type MixDeckTrack } from "./MixDeck";

export type EnergyArc = "preserve" | "build" | "release" | "reset";

export type MixCandidate = {
  track: MixDeckTrack;
  artworkUrl: string | null;
  bpm: number;
  camelotKey: string;
  suggestions: TransitionSuggestion[];
};

export type MixCandidatesByArc = Record<EnergyArc, MixCandidate[]>;

type Props = {
  outgoing: MixDeckTrack;
  initialEnergyArc: EnergyArc;
  candidatesByArc: MixCandidatesByArc;
};

const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function MixCandidatePicker({ outgoing, initialEnergyArc, candidatesByArc }: Props) {
  const [energyArc, setEnergyArc] = useState(initialEnergyArc);
  const candidates = candidatesByArc[energyArc];
  const [selectedId, setSelectedId] = useState(candidates[0]?.track.id ?? "");
  const deckRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => candidates.find(({ track }) => track.id === selectedId) ?? candidates[0],
    [candidates, selectedId],
  );
  const baseUrl = `/tracks/${outgoing.id}/backroom`;

  const chooseArc = (arc: EnergyArc) => {
    const next = candidatesByArc[arc][0];
    setEnergyArc(arc);
    setSelectedId(next?.track.id ?? "");
    window.history.replaceState(null, "", next ? `${baseUrl}?with=${next.track.id}&arc=${arc}` : `${baseUrl}?arc=${arc}`);
  };

  const chooseTrack = (id: string, revealDeck = false) => {
    setSelectedId(id);
    window.history.replaceState(null, "", `${baseUrl}?with=${id}&arc=${energyArc}`);
    if (revealDeck) requestAnimationFrame(() => deckRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return <div className={styles.candidateDesk}>
    <div className={styles.candidateControls}>
      <span>Shape next transition</span>
      <nav aria-label="Energy arc">
        {(["preserve", "build", "release", "reset"] as const).map((arc) =>
          <button key={arc} type="button" onClick={() => chooseArc(arc)} aria-pressed={arc === energyArc}>{arc}</button>
        )}
      </nav>
    </div>

    {candidates.length > 0 ? <>
      <div className={styles.candidateGrid}>
        {candidates.map((candidate, index) => {
          const suggestion = candidate.suggestions[0];
          const isSelected = candidate.track.id === selected?.track.id;
          return <article key={candidate.track.id} className={styles.candidateCard} data-selected={isSelected || undefined}>
            <button className={styles.candidateCardTarget} type="button" onClick={() => chooseTrack(candidate.track.id)} aria-label={`Load ${candidate.track.artist} — ${candidate.track.title} into incoming deck`} />
            <div className={styles.candidateArt}>
              {candidate.artworkUrl ? <img src={candidate.artworkUrl} alt="" /> : <span>SC</span>}
              <b>0{index + 1}</b>
            </div>
            <div className={styles.candidateIdentity}>
              <small>{candidate.track.artist}</small>
              <h3>{candidate.track.title}</h3>
              <p>{suggestion.reasons.join(" · ")}</p>
            </div>
            <div className={styles.candidateRoute}>
              <span><small>OUT</small>{time(suggestion.outgoing.startSec)}–{time(suggestion.outgoing.endSec)}</span>
              <i>→</i>
              <span><small>IN</small>{time(suggestion.incoming.startSec)}–{time(suggestion.incoming.endSec)}</span>
            </div>
            <div className={styles.candidateStats}>
              <span>{candidate.bpm.toFixed(1)} <small>BPM</small></span>
              <span>{candidate.camelotKey} <small>KEY</small></span>
              <strong>{Math.round(suggestion.score * 100)}<small>/100</small></strong>
            </div>
            <div className={styles.candidateActions}>
              <a href={`/tracks/${candidate.track.id}`}>Open DJ Agent ↗</a>
              <a href={`/tracks/${candidate.track.id}/backroom`}>Backroom ↗</a>
              <button type="button" onClick={() => chooseTrack(candidate.track.id, true)}>{isSelected ? "View deck ↓" : "Load deck ↓"}</button>
            </div>
          </article>;
        })}
      </div>
      {selected && <div ref={deckRef} className={styles.candidateDeck}><MixDeck outgoing={outgoing} incoming={selected.track} suggestions={selected.suggestions} energyArc={energyArc} /></div>}
    </> : <div className={styles.mixUnavailable}>
      <b>NO ANALYZED MATCHES YET</b>
      <p>Backroom needs another current-version analysis with compatible tempo and usable runway.</p>
    </div>}

    <details className={styles.specificTrack}>
      <summary>Use specific SoundCloud track</summary>
      <form action={baseUrl}>
        <input name="with" inputMode="numeric" pattern="[0-9]+" placeholder="Track ID" required />
        <input type="hidden" name="arc" value={energyArc} />
        <button>Compare →</button>
      </form>
    </details>
  </div>;
}
