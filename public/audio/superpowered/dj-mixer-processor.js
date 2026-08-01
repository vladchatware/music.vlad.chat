import { SuperpoweredWebAudio } from "./Superpowered.js";

const DECKS = ["A", "B"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

class SuperpoweredDJMixerProcessor extends SuperpoweredWebAudio.AudioWorkletProcessor {
  onReady() {
    this.players = {};
    this.playerBuffers = {};
    this.eqBuffers = {};
    this.equalizers = {};
    this.deckGain = { A: 1, B: 0 };
    this.pitchSemitones = { A: 0, B: 0 };
    this.loaded = { A: false, B: false };
    this.ended = { A: false, B: false };
    this.wasPlaying = { A: false, B: false };
    this.originalBpm = { A: 0, B: 0 };
    this.expectedDurationSec = { A: 0, B: 0 };
    this.pendingLoads = new Map();
    this.pendingOpen = { A: null, B: null };
    this.transition = null;
    this.automations = [];
    this.telemetryCounter = 0;

    for (const deck of DECKS) {
      const player = new this.Superpowered.AdvancedAudioPlayer(
        this.samplerate,
        8,
        2,
        0,
        0.501,
        2,
        false,
      );
      player.timeStretching = true;
      player.timeStretchingSound = 1;
      player.outputSamplerate = this.samplerate;
      this.players[deck] = player;
      this.playerBuffers[deck] = new this.Superpowered.Float32Buffer(128 * 2);
      this.eqBuffers[deck] = new this.Superpowered.Float32Buffer(128 * 2);
      const eq = new this.Superpowered.ThreeBandEQ(this.samplerate);
      eq.enabled = true;
      eq.low = 1;
      eq.mid = 1;
      eq.high = 1;
      this.equalizers[deck] = eq;
    }

    this.masterBuffer = new this.Superpowered.Float32Buffer(128 * 2);
    this.compressorBuffer = new this.Superpowered.Float32Buffer(128 * 2);
    this.compressor = new this.Superpowered.Compressor(this.samplerate);
    this.compressor.enabled = true;
    this.compressor.inputGainDb = 0;
    this.compressor.outputGainDb = 0;
    this.compressor.wet = 1;
    this.compressor.attackSec = 0.01;
    this.compressor.releaseSec = 0.25;
    this.compressor.ratio = 2;
    this.compressor.thresholdDb = -10;
    this.compressor.hpCutOffHz = 80;
    this.limiter = new this.Superpowered.Limiter(this.samplerate);
    this.limiter.enabled = true;
    this.limiter.ceilingDb = -0.3;
    this.limiter.thresholdDb = -3;
    this.limiter.releaseSec = 0.08;
    this.sendMessageToMainScope({ type: "ready" });
  }

  onDestruct() {
    for (const deck of DECKS) {
      this.players[deck]?.destruct();
      this.equalizers[deck]?.destruct();
      this.playerBuffers[deck]?.free();
      this.eqBuffers[deck]?.free();
    }
    this.masterBuffer?.free();
    this.compressorBuffer?.free();
    this.compressor?.destruct();
    this.limiter?.destruct();
  }

  ack(requestId) {
    if (typeof requestId === "number") {
      this.sendMessageToMainScope({ type: "ack", requestId });
    }
  }

  fail(deck, requestId, error) {
    this.sendMessageToMainScope({
      type: "deck-error",
      deck,
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  onMessageFromMainScope(message) {
    if (message?.SuperpoweredLoadError) {
      const url = message.SuperpoweredLoadError.url;
      const queue = this.pendingLoads.get(url);
      const load = queue?.shift();
      if (queue?.length === 0) this.pendingLoads.delete(url);
      if (load) {
        this.fail(load.deck, load.requestId, message.SuperpoweredLoadError.message);
      }
      return;
    }
    if (message?.SuperpoweredLoaded) {
      const url = message.SuperpoweredLoaded.url;
      const queue = this.pendingLoads.get(url);
      const load = queue?.shift();
      if (!load) return;
      if (queue.length === 0) this.pendingLoads.delete(url);
      try {
        const player = this.players[load.deck];
        player.pause(0, 0);
        player.openMemory(
          this.Superpowered.arrayBufferToWASM(message.SuperpoweredLoaded.buffer),
          false,
          false,
        );
        player.originalBPM = load.bpm;
        player.playbackRate = 1;
        player.pitchShiftCents = 0;
        this.originalBpm[load.deck] = load.bpm;
        this.expectedDurationSec[load.deck] = load.durationSec;
        this.loaded[load.deck] = true;
        this.ended[load.deck] = false;
        this.pendingOpen[load.deck] = null;
        this.sendMessageToMainScope({
          type: "deck-loaded",
          deck: load.deck,
          requestId: load.requestId,
          state: this.deckState(load.deck),
        });
      } catch (error) {
        this.fail(load.deck, load.requestId, error);
      }
      return;
    }

    const deck = message?.deck;
    const player = deck ? this.players[deck] : null;
    try {
      switch (message?.type) {
        case "load":
          if (!player || !message.url) throw new Error("Invalid deck load command");
          const queue = this.pendingLoads.get(message.url) || [];
          queue.push({
            deck,
            requestId: message.requestId,
            bpm: Number(message.bpm) || 0,
            durationSec: Number(message.durationSec) || 0,
          });
          this.pendingLoads.set(message.url, queue);
          this.Superpowered.downloadAndDecode(message.url, this);
          break;
        case "play":
          if (!this.loaded[deck]) throw new Error(`Deck ${deck} is not loaded`);
          player.play();
          this.ended[deck] = false;
          this.ack(message.requestId);
          break;
        case "pause":
          player?.pause(0, 0);
          this.ended[deck] = false;
          this.ack(message.requestId);
          break;
        case "stop":
          for (const target of deck ? [deck] : DECKS) {
            this.players[target].pause(0, 0);
            this.players[target].setPosition(0, true, false, false, false);
            this.ended[target] = false;
          }
          this.transition = null;
          this.ack(message.requestId);
          break;
        case "seek":
          player?.setPosition(message.seconds * 1000, false, false, false, false);
          this.ended[deck] = false;
          this.ack(message.requestId);
          break;
        case "cue":
          player?.setPosition(message.seconds * 1000, true, false, false, false);
          this.ended[deck] = false;
          this.ack(message.requestId);
          break;
        case "loop":
          player?.loopBetween(
            message.startSec * 1000,
            message.endSec * 1000,
            true,
            255,
            false,
            message.repetitions || 0,
            false,
            false,
          );
          this.ack(message.requestId);
          break;
        case "exit-loop":
          player?.exitLoop(false);
          this.ack(message.requestId);
          break;
        case "tempo":
          player.playbackRate = message.playbackRate;
          player.timeStretching = true;
          this.ack(message.requestId);
          break;
        case "pitch":
          player.pitchShiftCents = Math.round(message.semitones * 100);
          player.timeStretching = true;
          this.pitchSemitones[deck] = message.semitones;
          this.ack(message.requestId);
          break;
        case "sync": {
          const other = this.players[message.otherDeck];
          const sourceBpm = message.bpm || this.originalBpm[deck];
          const targetBpm = other?.getCurrentBpm?.() || this.originalBpm[message.otherDeck];
          if (sourceBpm > 0 && targetBpm > 0) {
            player.playbackRate = clamp(targetBpm / sourceBpm, 0.5, 2);
          }
          this.ack(message.requestId);
          break;
        }
        case "bend":
          player?.pitchBend(
            Math.abs(message.percent) / 100,
            0,
            message.percent >= 0,
            message.holdMs,
          );
          this.ack(message.requestId);
          break;
        case "gain":
          this.deckGain[deck] = message.gain;
          this.ack(message.requestId);
          break;
        case "eq":
          this.setEQ(deck, message.bands);
          this.ack(message.requestId);
          break;
        case "automation":
          this.addAutomation(message.automation);
          this.ack(message.requestId);
          break;
        case "transition": {
          const transition = message.transition;
          const startFrame = currentFrame + 128;
          this.players[transition.incomingDeck].setPosition(
            transition.incomingStartSec * 1000,
            true,
            false,
            false,
            false,
          );
          this.transition = {
            ...transition,
            requestId: message.requestId,
            startFrame,
            durationFrames: Math.max(1, Math.round(transition.durationSec * this.samplerate)),
            started: false,
          };
          this.ended[transition.incomingDeck] = false;
          this.ack(message.requestId);
          break;
        }
      }
    } catch (error) {
      this.fail(deck || "A", message?.requestId, error);
    }
  }

  setEQ(deck, bands) {
    const eq = this.equalizers[deck];
    if (!eq || !bands) return;
    eq.low = clamp(Number(bands.low), 0, 8);
    eq.mid = clamp(Number(bands.mid), 0, 8);
    eq.high = clamp(Number(bands.high), 0, 8);
  }

  addAutomation(automation) {
    if (!automation) return;
    this.automations.push({
      ...automation,
      startFrame: Math.round(automation.atContextTimeSec * this.samplerate),
      durationFrames: Math.max(1, Math.round(automation.durationSec * this.samplerate)),
    });
  }

  applyAutomations(blockFrame) {
    this.automations = this.automations.filter((automation) => {
      const progress = clamp(
        (blockFrame - automation.startFrame) / automation.durationFrames,
        0,
        1,
      );
      if (blockFrame >= automation.startFrame) {
        if (automation.type === "gain") {
          this.deckGain[automation.deck] =
            automation.from + (automation.to - automation.from) * progress;
        } else if (automation.type === "eq") {
          this.setEQ(automation.deck, {
            low: automation.from.low + (automation.to.low - automation.from.low) * progress,
            mid: automation.from.mid + (automation.to.mid - automation.from.mid) * progress,
            high: automation.from.high + (automation.to.high - automation.from.high) * progress,
          });
        }
      }
      return progress < 1;
    });
  }

  eqAtProgress(keyframes, progress) {
    if (!keyframes?.length) return null;
    if (progress <= keyframes[0].time) return keyframes[0].bands;
    for (let index = 1; index < keyframes.length; index++) {
      const right = keyframes[index];
      const left = keyframes[index - 1];
      if (progress <= right.time) {
        const amount = (progress - left.time) / Math.max(0.0001, right.time - left.time);
        return {
          low: left.bands.low + (right.bands.low - left.bands.low) * amount,
          mid: left.bands.mid + (right.bands.mid - left.bands.mid) * amount,
          high: left.bands.high + (right.bands.high - left.bands.high) * amount,
        };
      }
    }
    return keyframes[keyframes.length - 1].bands;
  }

  transitionGains(frame) {
    const transition = this.transition;
    if (!transition || frame < transition.startFrame) return null;
    if (!transition.started) {
      this.players[transition.incomingDeck].play();
      transition.started = true;
    }
    const progress = clamp(
      (frame - transition.startFrame) / transition.durationFrames,
      0,
      1,
    );
    let outgoing = 1 - progress;
    let incoming = progress;
    if (transition.curve === "equal_power") {
      outgoing = Math.cos(progress * Math.PI * 0.5);
      incoming = Math.sin(progress * Math.PI * 0.5);
    } else if (transition.curve === "cut") {
      outgoing = progress < 0.5 ? 1 : 0;
      incoming = progress < 0.5 ? 0 : 1;
    }
    return { progress, outgoing, incoming };
  }

  deckState(deck) {
    const player = this.players[deck];
    const decodedDuration = this.loaded[deck] ? player.getDurationMs() / 1000 : 0;
    const duration =
      Number.isFinite(decodedDuration) && decodedDuration > 0 && decodedDuration < 4_000_000
        ? decodedDuration
        : this.expectedDurationSec[deck];
    return {
      loaded: this.loaded[deck],
      playing: this.loaded[deck] && player.isPlaying(),
      ended: this.ended[deck],
      positionSec: this.loaded[deck] ? player.getDisplayPositionMs() / 1000 : 0,
      durationSec: duration,
      playbackRate: player.playbackRate,
      pitchSemitones: this.pitchSemitones[deck],
      gain: this.deckGain[deck],
    };
  }

  inspectPlayerEvents() {
    const Player = this.Superpowered.AdvancedAudioPlayer;
    for (const deck of DECKS) {
      const player = this.players[deck];
      const event = player.getLatestEvent();
      if (event === Player.PlayerEvent_Opened) {
        if (this.loaded[deck] && !this.pendingOpen[deck]) continue;
        this.loaded[deck] = true;
        this.ended[deck] = false;
        const pending = this.pendingOpen[deck];
        this.pendingOpen[deck] = null;
        this.sendMessageToMainScope({
          type: "deck-loaded",
          deck,
          requestId: pending?.requestId,
          state: this.deckState(deck),
        });
      } else if (event === Player.PlayerEvent_OpenFailed) {
        const pending = this.pendingOpen[deck];
        this.pendingOpen[deck] = null;
        this.fail(deck, pending?.requestId, `Superpowered decoder error ${player.getOpenErrorCode()}`);
      }
    }
  }

  processAudio(_input, outputBuffers, buffersize) {
    this.inspectPlayerEvents();
    this.applyAutomations(currentFrame);
    const deckAudible = {};

    for (let deckIndex = 0; deckIndex < DECKS.length; deckIndex++) {
      const deck = DECKS[deckIndex];
      const player = this.players[deck];
      player.outputSamplerate = this.samplerate;
      const raw = this.playerBuffers[deck];
      const processed = this.eqBuffers[deck];
      const audible =
        this.loaded[deck] && player.processStereo(raw.pointer, false, buffersize, 1);
      deckAudible[deck] = audible;
      if (!audible) this.Superpowered.memorySet(raw.pointer, 0, buffersize * 8);
      const eq = this.equalizers[deck];
      eq.samplerate = this.samplerate;
      if (!eq.process(raw.pointer, processed.pointer, buffersize)) {
        processed.array.set(raw.array);
      }
      outputBuffers[deckIndex + 1].array.set(processed.array);
    }

    const master = this.masterBuffer.array;
    const a = this.eqBuffers.A.array;
    const b = this.eqBuffers.B.array;
    const transition = this.transition;
    if (transition) {
      const blockProgress = clamp(
        (currentFrame - transition.startFrame) / transition.durationFrames,
        0,
        1,
      );
      if (currentFrame >= transition.startFrame) {
        const outgoingEQ = this.eqAtProgress(transition.outgoingEQ, blockProgress);
        const incomingEQ = this.eqAtProgress(transition.incomingEQ, blockProgress);
        if (outgoingEQ) this.setEQ(transition.outgoingDeck, outgoingEQ);
        if (incomingEQ) this.setEQ(transition.incomingDeck, incomingEQ);
      }
    }

    for (let frameIndex = 0; frameIndex < buffersize; frameIndex++) {
      const frame = currentFrame + frameIndex;
      const transitionMix = this.transitionGains(frame);
      let gainA = this.deckGain.A;
      let gainB = this.deckGain.B;
      if (transitionMix && transition) {
        if (transition.outgoingDeck === "A") {
          gainA *= transitionMix.outgoing;
          gainB *= transitionMix.incoming;
        } else {
          gainB *= transitionMix.outgoing;
          gainA *= transitionMix.incoming;
        }
      }
      const offset = frameIndex * 2;
      master[offset] = a[offset] * gainA + b[offset] * gainB;
      master[offset + 1] = a[offset + 1] * gainA + b[offset + 1] * gainB;
    }

    this.compressor.samplerate = this.samplerate;
    if (
      !this.compressor.process(
        this.masterBuffer.pointer,
        this.compressorBuffer.pointer,
        buffersize,
      )
    ) {
      this.compressorBuffer.array.set(master);
    }
    this.limiter.samplerate = this.samplerate;
    if (
      !this.limiter.process(
        this.compressorBuffer.pointer,
        outputBuffers[0].pointer,
        buffersize,
      )
    ) {
      outputBuffers[0].array.set(this.compressorBuffer.array);
    }

    if (
      transition &&
      transition.started &&
      currentFrame + buffersize >= transition.startFrame + transition.durationFrames
    ) {
      this.players[transition.outgoingDeck].pause(0, 0);
      this.deckGain[transition.outgoingDeck] = 0;
      this.deckGain[transition.incomingDeck] = 1;
      this.setEQ(transition.outgoingDeck, { low: 1, mid: 1, high: 1 });
      this.setEQ(transition.incomingDeck, { low: 1, mid: 1, high: 1 });
      this.sendMessageToMainScope({
        type: "transition-complete",
        outgoingDeck: transition.outgoingDeck,
        incomingDeck: transition.incomingDeck,
      });
      this.transition = null;
    }

    for (const deck of DECKS) {
      const state = this.deckState(deck);
      if (
        this.wasPlaying[deck] &&
        !state.playing &&
        state.durationSec > 0 &&
        state.positionSec >= state.durationSec - 0.08
      ) {
        this.ended[deck] = true;
        this.sendMessageToMainScope({
          type: "deck-ended",
          deck,
          state: this.deckState(deck),
        });
      }
      this.wasPlaying[deck] = state.playing;
    }

    this.telemetryCounter += 1;
    if (this.telemetryCounter >= 30) {
      this.telemetryCounter = 0;
      this.sendMessageToMainScope({
        type: "state",
        decks: { A: this.deckState("A"), B: this.deckState("B") },
      });
    }
  }
}

if (typeof AudioWorkletProcessor === "function") {
  registerProcessor("SuperpoweredDJMixerProcessor", SuperpoweredDJMixerProcessor);
}

export default SuperpoweredDJMixerProcessor;
