declare module "essentia.js" {
  export const EssentiaWASM: unknown;
  export const EssentiaModel: {
    TensorflowMusiCNN: new (tfjs: unknown, modelPath: unknown, verbose?: boolean) => {
      initialize(): Promise<void>;
      predict(input: unknown, zeroPadding?: boolean): Promise<unknown[]>;
    };
    EssentiaTFInputExtractor: new (wasm: unknown, extractorType?: string, isDebug?: boolean) => {
      computeFrameWise(audio: Float32Array, hopSize?: number): unknown;
      delete(): void;
      shutdown(): void;
    };
  };
  export class Essentia {
    constructor(wasm: unknown, isDebug?: boolean);
    arrayToVector(input: Float32Array): any;
    vectorToArray(input: any): Float32Array;
    RhythmExtractor2013(
      signal: any,
      maxTempo?: number,
      method?: string,
      minTempo?: number,
    ): any;
    KeyExtractor(
      signal: any,
      averageDetuningCorrection?: boolean,
      frameSize?: number,
      hopSize?: number,
      hpcpSize?: number,
      maxFrequency?: number,
      maximumSpectralPeaks?: number,
      minFrequency?: number,
      pcpThreshold?: number,
      profileType?: string,
      sampleRate?: number,
    ): any;
    delete(): void;
  }
}
