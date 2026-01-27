# Coding Conventions

**Analysis Date:** 2026-01-27

## Naming Patterns

**Files:**
- PascalCase for React components: `MusicPlayer.tsx`, `Scene.tsx`
- camelCase for utilities and libraries: `transitionPlanner.ts`, `beatgrid.ts`
- kebab-case for test files: `transitionPlanner.test.ts`
- Index files for barrel exports: `index.ts`

**Functions:**
- camelCase for all functions: `createTransitionPlan`, `calculatePlaybackRate`
- Descriptive verb-noun pattern for actions: `snapToBeat`, `matchTempo`
- Prefix with `use` for React hooks: `useDualDeckEngine`, `useMusicPlayerStore`

**Variables:**
- camelCase for all variables: `sourceBpm`, `targetPlaybackRate`
- Descriptive names: `crossfadeDurationSec`, `isPhraseBoundary`
- Boolean variables prefixed with `is`, `has`, `should`: `isPlaying`, `hasReliableBPM`

**Types:**
- PascalCase for all types: `BeatGrid`, `TransitionPlan`, `DeckState`
- Descriptive suffixes for specific patterns: `Result`, `Snapshot`, `Controller`
- Union types use string literals: `'intro' | 'verse' | 'buildup'`

## Code Style

**Formatting:**
- No explicit formatting tool detected
- Manual formatting with consistent indentation
- 2-space indentation in most files
- Trailing commas in multi-line structures

**Linting:**
- No linting configuration detected
- TypeScript strict mode disabled (`"strict": false`)
- Manual code quality enforcement

## Import Organization

**Order:**
1. External libraries (React, Three.js, Vitest)
2. Internal type imports (`import type`)
3. Internal value imports
4. Relative imports

**Path Aliases:**
- `@/*` maps to project root for absolute imports
- Used consistently: `@/lib/soundcloud`, `@/convex/_generated/api`

**Example:**
```typescript
import React, { useCallback, useEffect } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { SoundCloudTrack } from "./types";
import { useDualDeckEngine } from "./engine/useDualDeckEngine";
```

## Error Handling

**Patterns:**
- Early returns for invalid inputs: `if (!Number.isFinite(sourceBpm)) return 1;`
- Try-catch blocks for async operations with console.warn
- Graceful fallbacks: `fallbackBpm: 120`
- Null checks before property access

**Validation:**
- Input validation at function boundaries
- Type guards for runtime checks
- Default values for optional parameters

## Logging

**Framework:** console methods only

**Patterns:**
- `console.warn` for non-critical failures
- `console.log` used sparingly for debugging
- No structured logging framework detected

## Comments

**When to Comment:**
- Module headers explaining purpose and design principles
- Complex algorithm explanations
- Business logic context
- Mathematical formulas and calculations

**JSDoc/TSDoc:**
- Comprehensive JSDoc for public APIs
- Parameter descriptions with @param
- Return value documentation with @returns
- Type information in comments for complex types

**Example:**
```typescript
/**
 * Calculate the playback rate needed to match target BPM to source BPM.
 * 
 * @param sourceBpm - BPM of the currently playing track
 * @param targetBpm - BPM of the incoming track
 * @param constraints - Tempo adjustment constraints
 * @returns Playback rate multiplier (e.g., 1.05 = 5% faster)
 */
```

## Function Design

**Size:** Functions kept small and focused (10-30 lines typical)

**Parameters:**
- Required parameters first, optional last
- Default values for optional parameters
- Object parameters for complex configurations

**Return Values:**
- Consistent return types
- Objects for complex return values
- Early returns for edge cases

## Module Design

**Exports:**
- Named exports preferred: `export function createTransitionPlan`
- Barrel files for clean imports: `export * from './tempo'`
- Type-only exports where appropriate

**Barrel Files:**
- Index files in each module directory
- Re-export all public APIs
- Clean separation of public/private APIs

**File Organization:**
- Types in dedicated `types.ts` files
- Implementation in feature-specific files
- Tests in `__tests__` directories

---

*Convention analysis: 2026-01-27*