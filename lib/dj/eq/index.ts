/**
 * EQ Module - Public Exports
 */

export * from './types';
export {
  getEQAtProgress,
  createBassSwapCurve,
  createFrequencySplitCurve,
  createSmoothCurve,
  createHighFirstCurve,
  getCurveByPreset,
} from './curves';
export {
  EQController,
  createEQController,
} from './controller';
