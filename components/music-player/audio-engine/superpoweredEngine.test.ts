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
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3000", hostname: "localhost" },
    });
    vi.stubGlobal("Worker", mocks.FakeWorker);
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
});
