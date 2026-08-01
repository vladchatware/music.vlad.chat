"use client";

import {
  SuperpoweredGlue,
  SuperpoweredWebAudio,
  type SuperpoweredAudioWorkletNode,
} from "@superpoweredsdk/web";

import type { EQBand } from "@/lib/dj";
import type {
  AudioDeckId,
  AudioEngine,
  AudioEngineEvent,
  AudioEngineListener,
  AudioEngineTrack,
  DeckPlaybackState,
  EngineTransition,
  ScheduledAutomation,
} from "./types";

const WASM_URL = "/audio/superpowered/superpowered.wasm";
const WORKLET_URL = "/audio/superpowered/dj-mixer-processor.js";
const TRACK_LOADER_URL = "/audio/superpowered/track-loader-worker.js";
const EVALUATION_KEY = "ExampleLicenseKey-WillExpire-OnNextUpdate";
const COMMAND_TIMEOUT_MS = 30_000;

type WorkletDeckState = Omit<DeckPlaybackState, "id">;

type WorkletMessage =
  | { type: "ready" }
  | { type: "ack"; requestId: number }
  | { type: "deck-loaded"; requestId: number; deck: AudioDeckId; state: WorkletDeckState }
  | { type: "deck-error"; requestId?: number; deck: AudioDeckId; message: string }
  | { type: "deck-ended"; deck: AudioDeckId; state: WorkletDeckState }
  | { type: "state"; decks: Record<AudioDeckId, WorkletDeckState> }
  | { type: "transition-complete"; outgoingDeck: AudioDeckId; incomingDeck: AudioDeckId };

type PendingRequest = {
  resolve: (message: WorkletMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const initialDeckState = (id: AudioDeckId): DeckPlaybackState => ({
  id,
  loaded: false,
  playing: false,
  ended: false,
  positionSec: 0,
  durationSec: 0,
  playbackRate: 1,
  pitchSemitones: 0,
  gain: id === "A" ? 1 : 0,
});

function getLicenseKey(): string {
  const configured = process.env.NEXT_PUBLIC_SUPERPOWERED_LICENSE_KEY?.trim();
  if (configured) return configured;
  const local =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "[::1]");
  if (local) return EVALUATION_KEY;
  throw new Error(
    "NEXT_PUBLIC_SUPERPOWERED_LICENSE_KEY is required outside localhost. Superpowered evaluation licensing does not permit public deployment.",
  );
}

function isWorkletMessage(value: unknown): value is WorkletMessage {
  return Boolean(value && typeof value === "object" && "type" in value);
}

export class SuperpoweredAudioEngine implements AudioEngine {
  private manager: SuperpoweredWebAudio | null = null;
  private node: SuperpoweredAudioWorkletNode | null = null;
  private initializePromise: Promise<void> | null = null;
  private disposed = false;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Set<AudioEngineListener>();
  private deckStates: Record<AudioDeckId, DeckPlaybackState> = {
    A: initialDeckState("A"),
    B: initialDeckState("B"),
  };
  private masterOutput: GainNode | null = null;
  private deckOutputs: Record<AudioDeckId, GainNode | null> = { A: null, B: null };
  private mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;

  get context(): AudioContext | null {
    return this.manager?.audioContext ?? null;
  }

  get outputNode(): AudioNode | null {
    return this.masterOutput;
  }

  get deckOutputNodes(): Readonly<Record<AudioDeckId, AudioNode | null>> {
    return this.deckOutputs;
  }

  get broadcastStream(): MediaStream | null {
    return this.mediaStreamDestination?.stream ?? null;
  }

  initialize(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Audio engine is disposed"));
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.initializeInternal();
    return this.initializePromise;
  }

  private async initializeInternal(): Promise<void> {
    const superpowered = await SuperpoweredGlue.Instantiate(getLicenseKey(), WASM_URL);
    if (this.disposed) return;
    this.installTrackLoader(superpowered);

    const manager = new SuperpoweredWebAudio(48_000, superpowered);
    const node = await manager.createAudioNodeAsync(
      WORKLET_URL,
      "SuperpoweredDJMixerProcessor",
      (message) => this.onWorkletMessage(message),
      0,
      3,
    );
    if (this.disposed) {
      node.destruct();
      await manager.audioContext.close();
      return;
    }

    const masterOutput = manager.audioContext.createGain();
    const silentA = manager.audioContext.createGain();
    const silentB = manager.audioContext.createGain();
    const broadcastDestination = manager.audioContext.createMediaStreamDestination();
    masterOutput.gain.value = 1;
    silentA.gain.value = 1;
    silentB.gain.value = 1;

    node.connect(masterOutput, 0);
    node.connect(silentA, 1);
    node.connect(silentB, 2);
    masterOutput.connect(manager.audioContext.destination);
    masterOutput.connect(broadcastDestination);
    this.manager = manager;
    this.node = node;
    this.masterOutput = masterOutput;
    this.deckOutputs = { A: silentA, B: silentB };
    this.mediaStreamDestination = broadcastDestination;
  }

  private installTrackLoader(superpowered: Awaited<ReturnType<typeof SuperpoweredGlue.Instantiate>>) {
    const wasmUrl = new URL(WASM_URL, window.location.origin).toString();
    superpowered.loadTrackInWorker = async (url: string, trackLoaderId: number) => {
      const worker = new Worker(TRACK_LOADER_URL, { type: "module" });
      const taggedWorker = worker as Worker & {
        __url__: string;
        trackLoaderID: number;
      };
      taggedWorker.__url__ = url;
      taggedWorker.trackLoaderID = trackLoaderId;
      taggedWorker.onmessage = (message: MessageEvent<{
        __transfer__?: ArrayBuffer;
        __error__?: string;
        __diagnostic__?: string;
        bytes?: number;
      }>) => {
        if (message.data.__diagnostic__) {
          return;
        }
        if (message.data.__error__) {
          this.node?.sendMessageToAudioScope({
            SuperpoweredLoadError: { url, message: message.data.__error__ },
          });
          taggedWorker.terminate();
          return;
        }
        if (!message.data.__transfer__) return;
        superpowered.transferLoadedTrack(message.data.__transfer__, taggedWorker);
      };
      taggedWorker.onerror = (event) => {
        this.node?.sendMessageToAudioScope({
          SuperpoweredLoadError: {
            url,
            message: event.message || "Superpowered decode worker failed",
          },
        });
        taggedWorker.terminate();
      };
      const resolvedUrl = new URL(url, window.location.origin).toString();
      taggedWorker.postMessage({ load: resolvedUrl, wasmUrl });
    };
  }

  private onWorkletMessage(value: unknown): void {
    if (!isWorkletMessage(value)) return;
    const message = value;
    if ("requestId" in message && typeof message.requestId === "number") {
      const request = this.pending.get(message.requestId);
      if (request) {
        clearTimeout(request.timer);
        this.pending.delete(message.requestId);
        if (message.type === "deck-error") request.reject(new Error(message.message));
        else request.resolve(message);
      }
    }

    if (message.type === "state") {
      this.deckStates = {
        A: { id: "A", ...message.decks.A },
        B: { id: "B", ...message.decks.B },
      };
      this.emit({ type: "state", decks: this.deckStates });
    } else if (message.type === "deck-loaded") {
      const state = { id: message.deck, ...message.state };
      this.deckStates[message.deck] = state;
      this.emit({ type: "deck-loaded", deck: message.deck, state });
    } else if (message.type === "deck-ended") {
      const state = { id: message.deck, ...message.state };
      this.deckStates[message.deck] = state;
      this.emit({ type: "deck-ended", deck: message.deck, state });
    } else if (message.type === "deck-error") {
      this.emit({ type: "deck-error", deck: message.deck, message: message.message });
    } else if (message.type === "transition-complete") {
      this.emit(message);
    }
  }

  private emit(event: AudioEngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async sendRequest(
    command: Record<string, unknown>,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<WorkletMessage> {
    await this.initialize();
    if (!this.node) throw new Error("Superpowered audio worklet failed to initialize");
    const requestId = ++this.requestId;
    const promise = new Promise<WorkletMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Audio engine command timed out: ${String(command.type)}`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    this.node.sendMessageToAudioScope({ ...command, requestId });
    return promise;
  }

  private send(command: Record<string, unknown>): void {
    if (this.node) {
      this.node.sendMessageToAudioScope(command);
      return;
    }
    void this.initialize().then(() => {
      this.node?.sendMessageToAudioScope(command);
    });
  }

  async loadDeck(deck: AudioDeckId, track: AudioEngineTrack): Promise<DeckPlaybackState> {
    const message = await this.sendRequest({
      type: "load",
      deck,
      url: track.url,
      trackId: String(track.id),
      bpm: track.bpm ?? 0,
      durationSec: track.durationSec ?? 0,
    });
    if (message.type !== "deck-loaded") throw new Error(`Deck ${deck} did not load`);
    return { id: deck, ...message.state };
  }

  async play(deck: AudioDeckId): Promise<void> {
    await this.initialize();
    if (this.context?.state === "suspended") await this.context.resume();
    await this.sendRequest({ type: "play", deck }, 5_000);
  }

  pause(deck: AudioDeckId): void {
    this.send({ type: "pause", deck });
  }

  stop(deck?: AudioDeckId): void {
    this.send({ type: "stop", deck });
  }

  seek(deck: AudioDeckId, seconds: number): void {
    this.send({ type: "seek", deck, seconds: Math.max(0, seconds) });
  }

  cue(deck: AudioDeckId, seconds: number): void {
    this.send({ type: "cue", deck, seconds: Math.max(0, seconds) });
  }

  loop(
    deck: AudioDeckId,
    startSec: number,
    endSec: number,
    repetitions = 0,
  ): void {
    this.send({ type: "loop", deck, startSec, endSec, repetitions });
  }

  exitLoop(deck: AudioDeckId): void {
    this.send({ type: "exit-loop", deck });
  }

  setTempo(deck: AudioDeckId, playbackRate: number): void {
    this.send({ type: "tempo", deck, playbackRate: Math.max(0.25, Math.min(4, playbackRate)) });
  }

  setPitch(deck: AudioDeckId, semitones: number): void {
    this.send({ type: "pitch", deck, semitones: Math.max(-24, Math.min(24, semitones)) });
  }

  syncTo(deck: AudioDeckId, otherDeck: AudioDeckId, bpm?: number): void {
    this.send({ type: "sync", deck, otherDeck, bpm: bpm ?? 0 });
  }

  bendTempo(deck: AudioDeckId, percent: number, holdMs = 250): void {
    this.send({ type: "bend", deck, percent, holdMs });
  }

  setGain(deck: AudioDeckId, gain: number): void {
    this.send({ type: "gain", deck, gain: Math.max(0, Math.min(2, gain)) });
  }

  setEQ(deck: AudioDeckId, bands: EQBand): void {
    this.send({ type: "eq", deck, bands });
  }

  scheduleAutomation(automation: ScheduledAutomation): void {
    this.send({ type: "automation", automation });
  }

  async scheduleTransition(transition: EngineTransition): Promise<void> {
    await this.sendRequest({ type: "transition", transition }, 5_000);
  }

  getPlaybackPosition(deck: AudioDeckId): number {
    return this.deckStates[deck].positionSec;
  }

  getDeckState(deck: AudioDeckId): DeckPlaybackState {
    return this.deckStates[deck];
  }

  getBeatPosition(deck: AudioDeckId, bpm: number, firstBeatSec = 0): number {
    if (!Number.isFinite(bpm) || bpm <= 0) return 0;
    return Math.max(0, (this.getPlaybackPosition(deck) - firstBeatSec) * bpm / 60);
  }

  getLatency(): number {
    const context = this.context;
    if (!context) return 0;
    return context.baseLatency + ("outputLatency" in context ? context.outputLatency : 0);
  }

  subscribe(listener: AudioEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Audio engine disposed"));
    }
    this.pending.clear();
    this.listeners.clear();
    this.node?.destruct();
    this.masterOutput?.disconnect();
    this.deckOutputs.A?.disconnect();
    this.deckOutputs.B?.disconnect();
    this.mediaStreamDestination?.disconnect();
    const context = this.context;
    this.node = null;
    this.manager = null;
    if (context && context.state !== "closed") await context.close();
  }
}
