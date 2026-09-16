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

// iOS Safari suspends Web Audio rendering (including AudioWorklets) as soon as
// the page is backgrounded or the screen locks. Only pages with an actively
// playing media element keep their audio session, so we hold one open with a
// looping digital-silence WAV (inaudible at any volume, never muted). It is
// started from the same gesture that starts playback and released when no deck
// is playing anymore.
const KEEP_ALIVE_SAMPLE_RATE = 8_000;
const KEEP_ALIVE_SECONDS = 1;

function createSilentWavUrl(): string {
  const dataBytes = KEEP_ALIVE_SAMPLE_RATE * KEEP_ALIVE_SECONDS * 2; // mono, 16-bit PCM
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, KEEP_ALIVE_SAMPLE_RATE, true);
  view.setUint32(28, KEEP_ALIVE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  // PCM samples stay zero-filled: digital silence.
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

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
  private deckLoads = new Map<
    AudioDeckId,
    { trackId: string; promise: Promise<DeckPlaybackState> }
  >();
  private listeners = new Set<AudioEngineListener>();
  private deckStates: Record<AudioDeckId, DeckPlaybackState> = {
    A: initialDeckState("A"),
    B: initialDeckState("B"),
  };
  private masterOutput: GainNode | null = null;
  private deckOutputs: Record<AudioDeckId, GainNode | null> = { A: null, B: null };
  private mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private keepAlive: HTMLAudioElement | null = null;
  private keepAliveUrl: string | null = null;
  private handleVisibilityChange: (() => void) | null = null;
  private handleContextStateChange: (() => void) | null = null;

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
    const licenseKey = getLicenseKey();
    const superpowered = await SuperpoweredGlue.Instantiate(licenseKey, WASM_URL);
    if (this.disposed) return;
    this.installTrackLoader(superpowered, licenseKey);

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
    this.installBackgroundPlaybackSupport(manager.audioContext);
  }

  // Foreground recovery: iOS pauses Web Audio on interruptions (phone calls,
  // Siri, other media) and does not always restore it. When the page becomes
  // visible again and a deck is still supposed to be playing, resume the
  // context and re-assert the keep-alive element.
  private installBackgroundPlaybackSupport(context: AudioContext): void {
    this.handleContextStateChange = () => {
      if (this.disposed || context.state !== "running") return;
      // The context just started rendering again (e.g. an interruption ended);
      // make sure the keep-alive element matches engine playback.
      this.syncKeepAlive();
    };
    context.addEventListener("statechange", this.handleContextStateChange);

    if (typeof document === "undefined") return;
    this.handleVisibilityChange = () => {
      if (this.disposed || document.visibilityState !== "visible") return;
      const anyPlaying = Object.values(this.deckStates).some((state) => state.playing);
      if (!anyPlaying) return;
      if (context.state !== "running") void context.resume().catch(() => {});
      this.startKeepAlive();
    };
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private ensureKeepAliveElement(): HTMLAudioElement | null {
    if (this.keepAlive) return this.keepAlive;
    if (typeof Audio === "undefined") return null;
    if (!this.keepAliveUrl) this.keepAliveUrl = createSilentWavUrl();
    const element = new Audio(this.keepAliveUrl);
    element.loop = true;
    element.preload = "auto";
    element.setAttribute("playsinline", "");
    this.keepAlive = element;
    return element;
  }

  // Must run inside the user gesture that starts playback: iOS only honors
  // media element play() calls made from a gesture.
  private startKeepAlive(): void {
    const element = this.ensureKeepAliveElement();
    if (!element) return;
    void Promise.resolve(element.play()).catch(() => {});
  }

  private syncKeepAlive(): void {
    const element = this.keepAlive;
    if (!element) return;
    const anyPlaying = Object.values(this.deckStates).some((state) => state.playing);
    if (anyPlaying) {
      this.startKeepAlive();
    } else if (!element.paused) {
      element.pause();
    }
  }

  private installTrackLoader(
    superpowered: Awaited<ReturnType<typeof SuperpoweredGlue.Instantiate>>,
    licenseKey: string,
  ) {
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
      taggedWorker.postMessage({ load: resolvedUrl, wasmUrl, licenseKey });
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

    if (message.type === "state" || message.type === "deck-ended") {
      this.syncKeepAlive();
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

  loadDeck(deck: AudioDeckId, track: AudioEngineTrack): Promise<DeckPlaybackState> {
    const trackId = String(track.id);
    const existing = this.deckLoads.get(deck);
    if (existing?.trackId === trackId) return existing.promise;

    const promise = this.sendRequest({
      type: "load",
      deck,
      url: track.url,
      trackId,
      bpm: track.bpm ?? 0,
      durationSec: track.durationSec ?? 0,
    }).then((message) => {
      if (message.type !== "deck-loaded") throw new Error(`Deck ${deck} did not load`);
      return { id: deck, ...message.state };
    });
    const tracked = promise.finally(() => {
      if (this.deckLoads.get(deck)?.promise === tracked) this.deckLoads.delete(deck);
    });
    this.deckLoads.set(deck, { trackId, promise: tracked });
    return tracked;
  }

  async play(deck: AudioDeckId): Promise<void> {
    // Kick this off before any awaits so it stays inside the user gesture.
    this.startKeepAlive();
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
    if (this.handleVisibilityChange && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.handleVisibilityChange = null;
    const context = this.context;
    if (context && this.handleContextStateChange) {
      context.removeEventListener("statechange", this.handleContextStateChange);
    }
    this.handleContextStateChange = null;
    this.keepAlive?.pause();
    this.keepAlive = null;
    if (this.keepAliveUrl) {
      URL.revokeObjectURL(this.keepAliveUrl);
      this.keepAliveUrl = null;
    }
    this.node?.destruct();
    this.masterOutput?.disconnect();
    this.deckOutputs.A?.disconnect();
    this.deckOutputs.B?.disconnect();
    this.mediaStreamDestination?.disconnect();
    this.node = null;
    this.manager = null;
    if (context && context.state !== "closed") await context.close();
  }
}
