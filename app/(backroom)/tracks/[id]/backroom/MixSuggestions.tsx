"use client";

import { useState } from "react";

import type { TransitionSuggestion } from "@/lib/dj";
import styles from "../../../backroom.module.css";
import MixCandidatePicker, { type MixCandidatesByArc } from "./MixCandidatePicker";
import MixDeck, { type MixDeckTrack } from "./MixDeck";

type Props = {
  outgoing: MixDeckTrack;
  incoming: MixDeckTrack;
  energyArc: "preserve" | "build" | "release" | "reset";
  suggestions: TransitionSuggestion[];
  candidatesByArc: MixCandidatesByArc;
};

export default function MixSuggestions({ outgoing, incoming, energyArc, suggestions, candidatesByArc }: Props) {
  const [showAll, setShowAll] = useState(false);

  const showAllSuggestions = () => {
    window.history.replaceState(null, "", `/tracks/${outgoing.id}/backroom?arc=${energyArc}`);
    setShowAll(true);
  };

  if (showAll) {
    return <MixCandidatePicker
      outgoing={outgoing}
      initialEnergyArc={energyArc}
      candidatesByArc={candidatesByArc}
    />;
  }

  if (suggestions.length === 0) {
    return <div className={styles.mixUnavailable}>
      <b>NO SAFE WINDOW</b>
      <p>Tempo incompatible, timing confidence too low, or less than one bar of usable runway.</p>
    </div>;
  }

  return <div className={styles.mixDesk}>
    <div className={styles.mixControls}>
      <span>{energyArc} energy arc</span>
      <div><a className={styles.allSuggestions} href={`/tracks/${outgoing.id}/backroom?arc=${energyArc}`} onClick={(event) => { event.preventDefault(); showAllSuggestions(); }}>← All suggestions</a><a className={styles.allSuggestions} href={`/tracks/${incoming.id}`}>DJ Agent ↗</a><a className={styles.swapTracks} href={`/tracks/${incoming.id}/backroom?with=${outgoing.id}&arc=${energyArc}`}>⇄ Swap direction</a></div>
    </div>
    <MixDeck outgoing={outgoing} incoming={incoming} suggestions={suggestions} energyArc={energyArc} />
  </div>;
}
