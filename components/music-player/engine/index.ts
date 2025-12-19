/**
 * Music Player Engine - Public Exports
 */

// State machine (legacy)
export { engineReducer, initialEngineState, type EnginePhase, type EngineState, type EngineAction } from './stateMachine';

// Cueing
export { cueTrackOnDeck, type CueingResult } from './cueing';

// Audio Analysis
export { useAudioAnalysis } from './useAudioAnalysis';

// Legacy Dual Deck Engine
export { useDualDeckEngine } from './useDualDeckEngine';

// New DJ Engine (recommended)
export { useDJEngine } from './useDJEngine';
