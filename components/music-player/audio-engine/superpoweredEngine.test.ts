import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sent: Array<Record<string, unknown>> = [];
  const workerMessages: Array<Record<string, unknown>> = [];
  let onMessage: ((message: unknown) => void) | null = null;
  const superpowered: {
    loadTrackInWorker?: (url: string, trackLoaderId: number) => Promise<void>;
    transferLoadedTrack: ReturnType<typeof vi.fn>;
  } = { transferLoadedTrack: vi.fn() };

  class FakeNode {
    connect() {}
    destruct() {}
    sendMessageToAudioScope(message: Record<string, unknown>) {
      sent.push(message);
      const requestId = message.requestId as number | undefined;
      if (message.type === "load") {
        queueMicrotask(() => onMessage?.({
          type: "deck-loaded",
          requestId,
          deck: message.deck,
          state: {
            loaded: true,
            playing: false,
            ended: false,
            positionSec: 0,
            durationSec: 180,
            playbackRate: 1,
            pitchSemitones: 0,
            gain: message.deck === "A" ? 1 : 0,
          },
        }));
      } else if (requestId) {
        queueMicrotask(() => onMessage?.({ type: "ack", requestId }));
      }
    }
  }

  class FakeWorker {
    onmessage: ((message: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage(message: Record<string, unknown>) {
      workerMessages.push(message);
    }
    terminate() {}
  }

  class FakeAudio {
    static instances: FakeAudio[] = [];
    loop = false;
    volume = 1;
    preload = "none";
    src = "";
    paused = true;
    play = vi.fn(async () => {
      this.paused = false;
    });
    pause = vi.fn(() => {
      this.paused = true;
    });
    setAttribute = vi.fn();
    constructor(src?: string) {
      this.src = src ?? "";
      FakeAudio.instances.push(this);
    }
  }

  const visibilityListeners = new Set<() => void>();
  const documentStub = {
    visibilityState: "visible",
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === "visibilitychange") visibilityListeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      visibilityListeners.delete(listener);
    }),
  };
  const fireVisibilityChange = () => {
    visibilityListeners.forEach((listener) => listener());
  };

  const gain = () => ({
    gain: { value: 0 },
    connect() {},
    disconnect() {},
  });
  const context = {
    state: "suspended",
    sampleRate: 48_000,
    baseLatency: 0.01,
    outputLatency: 0.02,
    destination: {},
    createGain: gain,
    createMediaStreamDestination: () => ({
      stream: { id: "broadcast" },
      connect() {},
      disconnect() {},
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
  };

  return {
    sent,
    workerMessages,
    superpowered,
    context,
    FakeNode,
    FakeWorker,
    FakeAudio,
    document: documentStub,
    fireVisibilityChange,
    emitWorkletMessage: (message: Record<string, unknown>) => {
      onMessage?.(message);
    },
    setOnMessage: (next: typeof onMessage) => { onMessage = next; },
  };
});

vi.mock("@superpoweredsdk/web", () => ({
  SuperpoweredGlue: {
    Instantiate: vi.fn(async () => mocks.superpowered),
  },
  SuperpoweredWebAudio: class {
    audioContext = mocks.context;
    async createAudioNodeAsync(
      _url: string,
      _name: string,
      onMessage: (message: unknown) => void,
    ) {
      mocks.setOnMessage(onMessage);
      return new mocks.FakeNode();
    }
  },
}));

import { SuperpoweredAudioEngine } from "./superpoweredEngine";

describe("SuperpoweredAudioEngine", () => {
  beforeEach(() => {
    mocks.sent.length = 0;
    mocks.workerMessages.length = 0;
    mocks.context.state = "suspended";
    mocks.FakeAudio.instances.length = 0;
    mocks.document.visibilityState = "visible";
    mocks.context.resume.mockClear();
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3000", hostname: "localhost" },
    });
    vi.stubGlobal("Worker", mocks.FakeWorker);
    vi.stubGlobal("Audio", mocks.FakeAudio);
    vi.stubGlobal("document", mocks.document);
    process.env.NEXT_PUBLIC_SUPERPOWERED_LICENSE_KEY = "test-license";
  });

  it("loads a deck through the worklet and exposes decoded duration", async () => {
    const engine = new SuperpoweredAudioEngine();
    const state = await engine.loadDeck("A", {
      id: 42,
      url: "/api/tracks/42/stream",
      bpm: 128,
    });

    expect(state).toMatchObject({
      id: "A",
      loaded: true,
      durationSec: 180,
    });
    expect(mocks.sent[0]).toMatchObject({
      type: "load",
      deck: "A",
      trackId: "42",
      bpm: 128,
    });
    await engine.dispose();
  });

  it("coalesces concurrent loads of the same track on one deck", async () => {
    const engine = new SuperpoweredAudioEngine();
    const track = { id: 42, url: "/api/tracks/42/stream", bpm: 128 };

    const [first, second] = await Promise.all([
      engine.loadDeck("A", track),
      engine.loadDeck("A", track),
    ]);

    expect(first).toEqual(second);
    expect(mocks.sent.filter((message) => message.type === "load")).toHaveLength(1);
    await engine.dispose();
  });

  it("passes the configured license key to track-loader workers", async () => {
    const engine = new SuperpoweredAudioEngine();
    await engine.initialize();

    await mocks.superpowered.loadTrackInWorker?.("/api/tracks/42/stream", 7);

    expect(mocks.workerMessages[0]).toMatchObject({
      load: "http://localhost:3000/api/tracks/42/stream",
      licenseKey: "test-license",
      wasmUrl: "http://localhost:3000/audio/superpowered/superpowered.wasm",
    });
    await engine.dispose();
  });

  it("resumes audio only on play and sends transport commands", async () => {
    const engine = new SuperpoweredAudioEngine();
    await engine.loadDeck("B", { id: 7, url: "/track.mp3" });
    await engine.play("B");
    engine.seek("B", 12.5);
    engine.setTempo("B", 1.08);
    engine.setPitch("B", 2);

    expect(mocks.context.resume).toHaveBeenCalled();
    expect(mocks.sent.map((message) => message.type)).toEqual([
      "load",
      "play",
      "seek",
      "tempo",
      "pitch",
    ]);
    await engine.dispose();
  });

  it("sends one atomic transition command and reports device latency", async () => {
    const engine = new SuperpoweredAudioEngine();
    await engine.initialize();
    await engine.scheduleTransition({
      outgoingDeck: "A",
      incomingDeck: "B",
      incomingStartSec: 32,
      durationSec: 15,
      curve: "equal_power",
    });

    expect(mocks.sent.at(-1)).toMatchObject({
      type: "transition",
      transition: {
        outgoingDeck: "A",
        incomingDeck: "B",
        incomingStartSec: 32,
        durationSec: 15,
        curve: "equal_power",
      },
    });
    expect(engine.getLatency()).toBeCloseTo(0.03);
    await engine.dispose();
  });

  it("starts a silent keep-alive loop on play and releases it when decks go idle", async () => {
    const engine = new SuperpoweredAudioEngine();
    await engine.play("A");

    expect(mocks.FakeAudio.instances).toHaveLength(1);
    const keepAlive = mocks.FakeAudio.instances[0];
    expect(keepAlive.loop).toBe(true);
    expect(keepAlive.src).toContain("blob:");
    expect(keepAlive.play).toHaveBeenCalledTimes(1);

    // Worklet telemetry with every deck idle must release the audio session.
    mocks.emitWorkletMessage({
      type: "state",
      decks: {
        A: { loaded: true, playing: false, ended: false, positionSec: 10, durationSec: 180, playbackRate: 1, pitchSemitones: 0, gain: 1 },
        B: { loaded: false, playing: false, ended: false, positionSec: 0, durationSec: 0, playbackRate: 1, pitchSemitones: 0, gain: 0 },
      },
    });
    expect(keepAlive.pause).toHaveBeenCalled();
    expect(keepAlive.paused).toBe(true);

    await engine.dispose();
    expect(mocks.document.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(mocks.context.removeEventListener).toHaveBeenCalledWith(
      "statechange",
      expect.any(Function),
    );
  });

  it("resumes the context and keep-alive when returning to the foreground mid-playback", async () => {
    const engine = new SuperpoweredAudioEngine();
    await engine.play("A");
    const keepAlive = mocks.FakeAudio.instances[0];

    // Simulate iOS suspending the session mid-playback. While suspended the
    // worklet stops rendering, so no "state" telemetry arrives — the engine
    // must still know a deck is playing (via deck state) and recover.
    mocks.context.state = "suspended";
    mocks.emitWorkletMessage({
      type: "deck-loaded",
      deck: "A",
      state: { loaded: true, playing: true, ended: false, positionSec: 30, durationSec: 180, playbackRate: 1, pitchSemitones: 0, gain: 1 },
    });
    mocks.fireVisibilityChange();

    expect(mocks.context.resume).toHaveBeenCalledTimes(2); // play() + foreground recovery
    expect(keepAlive.play).toHaveBeenCalledTimes(2);
    expect(keepAlive.paused).toBe(false);
    await engine.dispose();
  });

  it("does not resume the context when returning to the foreground while paused", async () => {
    const engine = new SuperpoweredAudioEngine();
    await engine.play("A");
    mocks.context.state = "suspended";
    mocks.emitWorkletMessage({
      type: "state",
      decks: {
        A: { loaded: true, playing: false, ended: false, positionSec: 30, durationSec: 180, playbackRate: 1, pitchSemitones: 0, gain: 1 },
        B: { loaded: false, playing: false, ended: false, positionSec: 0, durationSec: 0, playbackRate: 1, pitchSemitones: 0, gain: 0 },
      },
    });

    mocks.fireVisibilityChange();

    expect(mocks.context.resume).toHaveBeenCalledTimes(1); // only from play()
    await engine.dispose();
  });
});
