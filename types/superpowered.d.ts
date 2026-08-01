declare module "@superpoweredsdk/web" {
  export class SuperpoweredGlue {
    static Instantiate(
      licenseKey: string,
      wasmUrl?: string,
      sharedArrayBuffer?: boolean,
    ): Promise<SuperpoweredInstance>;
  }

  export class SuperpoweredWebAudio {
    constructor(sampleRate: number, superpowered: SuperpoweredInstance);
    readonly audioContext: AudioContext;
    createAudioNodeAsync(
      url: string,
      className: string,
      onMessage: (message: unknown) => void,
      numberOfInputs?: number,
      numberOfOutputs?: number,
    ): Promise<SuperpoweredAudioWorkletNode>;
  }

  export interface SuperpoweredInstance {
    downloadAndDecode(url: string, receiver: SuperpoweredAudioWorkletNode): void;
    loadTrackInWorker(url: string, trackLoaderId: number): Promise<void>;
    transferLoadedTrack(buffer: ArrayBuffer, worker: Worker): void;
  }

  export interface SuperpoweredAudioWorkletNode extends AudioWorkletNode {
    sendMessageToAudioScope(message: unknown, transfer?: Transferable[]): void;
    destruct(): void;
  }
}
