# Testing Patterns

**Analysis Date:** 2026-01-27

## Test Framework

**Runner:**
- Vitest 4.0.16
- Config: `vitest.config.ts`
- Environment: Node

**Assertion Library:**
- Built-in Vitest assertions (`expect`)
- No additional assertion library

**Run Commands:**
```bash
npm test              # Run all tests in watch mode
npm run test:run      # Run all tests once
npm run test:coverage # Run tests with coverage report
```

## Test File Organization

**Location:**
- Co-located tests in `__tests__` directories
- Test files mirror source structure

**Naming:**
- `[module].test.ts` pattern
- Same name as source file with `.test.ts` suffix

**Structure:**
```
lib/dj/
├── __tests__/
│   ├── transitionPlanner.test.ts
│   ├── tempo.test.ts
│   ├── harmonic.test.ts
│   └── ...
├── tempo/
│   ├── matcher.ts
│   └── beatgrid.ts
└── types.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('functionName', () => {
  beforeEach(() => {
    // Setup if needed
  });

  it('should handle basic case', () => {
    // Test implementation
  });

  it('should handle edge case', () => {
    // Test implementation
  });
});
```

**Patterns:**
- `describe` blocks for function/group testing
- `beforeEach` for common setup
- Mock factories for test data creation
- Descriptive test names starting with "should"

## Mocking

**Framework:** Vitest built-in mocking (`vi`)

**Patterns:**
```typescript
// Mock factory functions
const createMockDeck = (id: 'A' | 'B', bpm: number): DeckSnapshot => ({
  id,
  track: { id: id === 'A' ? 123 : 456, title: `Track ${id}`, bpm },
  positionSec: 0,
  beatGrid: { bpm, beatsPerBar: 4, firstDownbeat: 0, confidence: 0.9 },
  structureMap: null,
  energyCurve: null,
});

// Mock external dependencies
vi.mock('../module', () => ({
  functionName: vi.fn(() => mockResult),
}));
```

**What to Mock:**
- External API calls
- File system operations
- Time-dependent functions
- Complex dependencies

**What NOT to Mock:**
- Pure functions
- Simple data transformations
- Core business logic

## Fixtures and Factories

**Test Data:**
```typescript
// Default test data
const DEFAULT_ANALYSIS_SNAPSHOT: AnalysisSnapshot = {
  bpm: 120,
  bpmSource: 'metadata',
  section: 'verse',
  overallEnergy: 0.5,
  bassEnergy: 0.6,
  stillDurationMs: 0,
  dropDetected: false,
  beatPhase: 0,
  timeToNextBeatMs: 500,
};

// Factory functions for dynamic data
const createMockTrack = (overrides: Partial<Track> = {}): Track => ({
  id: 123,
  title: 'Test Track',
  artist: 'Test Artist',
  bpm: 128,
  duration: 300,
  ...overrides,
});
```

**Location:**
- Inline in test files
- Shared fixtures not detected
- Each test file contains its own factories

## Coverage

**Requirements:** Coverage configured but no explicit target

**View Coverage:**
```bash
npm run test:coverage    # Generate coverage report
# Reports generated in coverage/ directory
# HTML report available
```

**Configuration:**
```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'html'],
  include: ['lib/dj/**/*.ts'],
  exclude: ['**/*.test.ts', '**/index.ts', '**/types.ts'],
}
```

## Test Types

**Unit Tests:**
- Focus: Individual functions and modules
- Scope: `lib/dj/` modules extensively tested
- Approach: Pure function testing with deterministic inputs/outputs

**Integration Tests:**
- Not detected in current codebase
- Testing appears to be unit-focused

**E2E Tests:**
- Not detected
- Likely handled manually or not implemented

## Common Patterns

**Async Testing:**
```typescript
it('should handle async operations', async () => {
  const result = await asyncFunction(input);
  expect(result).toBeDefined();
});
```

**Error Testing:**
```typescript
it('should handle invalid inputs', () => {
  expect(() => functionThatThrows(invalidInput)).toThrow();
});

it('should return fallback for edge cases', () => {
  const result = functionWithFallback(edgeCaseInput);
  expect(result).toBe(fallbackValue);
});
```

**Numerical Precision:**
```typescript
it('should calculate precise values', () => {
  const result = calculateRate(120, 128);
  expect(result).toBeCloseTo(1.067, 2); // tolerance 2 decimal places
});
```

**Property Testing:**
- Not detected
- Tests use specific values rather than generative testing

**Snapshot Testing:**
- Not detected
- Tests use explicit assertions

---

*Testing analysis: 2026-01-27*