/**
 * DJ Library - Public API
 * 
 * This module exports all public types and functions for the DJ transition system.
 */

// Core Types
export * from './types';

// Tempo matching
export * from './tempo';

// Structure analysis
export * from './structure';

// Harmonic matching
export * from './harmonic';

// Energy analysis
export * from './energy';

// EQ control
export * from './eq';

// Engine (state machine + planner)
export * from './engine';

// Declarative agent performance plans
export * from './performance';

// Analyzed segment pairing
export * from './segments/scoring';
export * from './segments/suggestions';

// Rolling agent-authored / player-consumed score
export * from './timeline';
