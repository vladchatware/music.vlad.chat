import type { EQBand, EQCurve } from "@/lib/dj";

export type AudioDeckId = "A" | "B";
export type CrossfaderCurve = "linear" | "equal_power" | "cut";

export type AudioEngineTrack = {
  id: string | number;
  url: string;
  bpm?: number | null;
  durationSec?: number | null;
};

export type DeckPlaybackState = {
  id: AudioDeckId;
  loaded: boolean;
  playing: boolean;
  ended: boolean;
  positionSec: number;
  durationSec: number;
  playbackRate: number;
  pitchSemitones: number;
  gain: number;
};

export type ScheduledAutomation =
  | {
      type: "gain";
      deck: AudioDeckId;
      atContextTimeSec: number;
      durationSec: number;
      from: number;
      to: number;
    }
  | {
      type: "eq";
      deck: AudioDeckId;
      atContextTimeSec: number;
      durationSec: number;
      from: EQBand;
      to: EQBand;
    };

export type EngineTransition = {
  outgoingDeck: AudioDeckId;
  incomingDeck: AudioDeckId;
  incomingStartSec: number;
  durationSec: number;
  curve: CrossfaderCurve;
  outgoingEQ?: EQCurve["outgoing"];
  incomingEQ?: EQCurve["incoming"];
};

export type AudioEngineEvent =
  | { type: "deck-loaded"; deck: AudioDeckId; state: DeckPlaybackState }
  | { type: "deck-ended"; deck: AudioDeckId; state: DeckPlaybackState }
  | { type: "deck-error"; deck: AudioDeckId; message: string }
  | { type: "state"; decks: Record<AudioDeckId, DeckPlaybackState> }
  | { type: "transition-complete"; outgoingDeck: AudioDeckId; incomingDeck: AudioDeckId };

export type AudioEngineListener = (event: AudioEngineEvent) => void;

export interface AudioEngine {
  readonly context: AudioContext | null;
  readonly outputNode: AudioNode | null;
  readonly deckOutputNodes: Readonly<Record<AudioDeckId, AudioNode | null>>;
  readonly broadcastStream: MediaStream | null;

  initialize(): Promise<void>;
  loadDeck(deck: AudioDeckId, track: AudioEngineTrack): Promise<DeckPlaybackState>;
  play(deck: AudioDeckId): Promise<void>;
  pause(deck: AudioDeckId): void;
  stop(deck?: AudioDeckId): void;
  seek(deck: AudioDeckId, seconds: number): void;
  cue(deck: AudioDeckId, seconds: number): void;
  loop(deck: AudioDeckId, startSec: number, endSec: number, repetitions?: number): void;
  exitLoop(deck: AudioDeckId): void;
  setTempo(deck: AudioDeckId, playbackRate: number): void;
  setPitch(deck: AudioDeckId, semitones: number): void;
  syncTo(deck: AudioDeckId, otherDeck: AudioDeckId, bpm?: number): void;
  bendTempo(deck: AudioDeckId, percent: number, holdMs?: number): void;
  setGain(deck: AudioDeckId, gain: number): void;
  setEQ(deck: AudioDeckId, bands: EQBand): void;
  scheduleAutomation(automation: ScheduledAutomation): void;
  scheduleTransition(transition: EngineTransition): Promise<void>;
  getPlaybackPosition(deck: AudioDeckId): number;
  getDeckState(deck: AudioDeckId): DeckPlaybackState;
  getBeatPosition(deck: AudioDeckId, bpm: number, firstBeatSec?: number): number;
  getLatency(): number;
  subscribe(listener: AudioEngineListener): () => void;
  dispose(): Promise<void>;
}
