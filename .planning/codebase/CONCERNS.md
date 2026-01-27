# Codebase Concerns

**Analysis Date:** 2026-01-27

## Tech Debt

**TypeScript Type Issues:**
- Issue: Multiple @ts-ignore comments suppressing TypeScript errors
- Files: `app/api/chat/route.ts:42`, `lib/analyzers/ftt.ts:277`
- Impact: Type safety is compromised, potential runtime errors
- Fix approach: Address underlying type issues and remove @ts-ignore comments

**Large Complex Files:**
- Issue: Several files exceed 400+ lines indicating high complexity
- Files: `components/music-player/engine/useDualDeckEngine.ts` (872 lines), `components/music-player/engine/useDJEngine.ts` (841 lines)
- Impact: Difficult to maintain, test, and understand
- Fix approach: Break down into smaller, focused modules and extract reusable components

**Excessive Console Logging:**
- Issue: Production code contains console.log statements used for debugging
- Files: Multiple files including `app/api/audio/transcriptions/route.ts`, `soundcloud.ts`, `convex/http.ts`, `components/music-player/`
- Impact: Performance overhead and information leakage in production
- Fix approach: Implement proper logging framework and remove debug console statements

## Known Bugs

**Token Refresh Logic:**
- Symptoms: Token expiration handling may fail silently
- Files: `soundcloud.ts:149-156`
- Trigger: When SoundCloud access token expires
- Workaround: Manual token refresh process exists but may not handle all edge cases

**Audio Deck Unlock Issues:**
- Symptoms: "Deck unlock skipped" errors logged but not handled
- Files: `components/music-player/engine/useDualDeckEngine.ts:155`
- Trigger: iOS devices with audio autoplay restrictions
- Workaround: Error is caught and logged but playback may fail

## Security Considerations

**Environment Variable Exposure:**
- Risk: Sensitive keys may be exposed in client-side code
- Files: `app/ConvexContextProvider.tsx:7`, multiple API routes use environment variables
- Current mitigation: Environment variables used directly without validation
- Recommendations: Add environment variable validation and ensure server-side only access for secrets

**API Key Management:**
- Risk: OpenAI and Stripe API keys stored in environment without encryption
- Files: `app/api/responses/route.ts`, `lib/stripe.ts`, `convex/http.ts`
- Current mitigation: Environment variables used
- Recommendations: Implement key rotation strategy and consider secret management service

**Input Validation:**
- Risk: Limited input validation on API endpoints
- Files: `app/api/chat/route.ts` uses Zod but other routes may lack validation
- Current mitigation: Zod schema validation in some routes
- Recommendations: Implement comprehensive input validation across all API endpoints

## Performance Bottlenecks

**Large Audio Processing Files:**
- Problem: Audio analysis files are large and complex
- Files: `lib/analyzers/ftt.ts` (382 lines), `lib/dj/energy/analyzer.ts` (455 lines)
- Cause: Complex audio processing logic without optimization
- Improvement path: Implement Web Workers for heavy processing and optimize algorithms

**Synchronous Operations:**
- Problem: Some operations block the main thread
- Files: Audio processing in `lib/dj/` modules
- Cause: Heavy computation performed synchronously
- Improvement path: Move to Web Workers or use async processing

## Fragile Areas

**Audio Engine State Management:**
- Files: `components/music-player/engine/useDJEngine.ts`, `components/music-player/engine/useDualDeckEngine.ts`
- Why fragile: Complex state interactions between multiple audio decks
- Safe modification: Use proper state isolation and test extensively
- Test coverage: Limited test coverage for edge cases

**Error Handling Patterns:**
- Files: Multiple API routes and components have inconsistent error handling
- Why fragile: Mix of try/catch with empty catches and different error responses
- Safe modification: Standardize error handling approach
- Test coverage: Error scenarios not properly tested

**Token and Authentication Logic:**
- Files: `soundcloud.ts`, `convex/auth.ts`, `app/api/chat/route.ts`
- Why fragile: Complex token management and authentication flows
- Safe modification: Carefully test authentication edge cases
- Test coverage: Authentication testing appears limited

## Scaling Limits

**Audio Processing Resources:**
- Current capacity: Single-threaded audio processing
- Limit: CPU-bound operations will not scale with concurrent users
- Scaling path: Implement server-side audio processing or distributed processing

**Database Queries:**
- Current capacity: Convex queries without optimization
- Limit: May become bottleneck with large user base
- Scaling path: Implement query optimization and caching

## Dependencies at Risk

**React Three Fiber Ecosystem:**
- Risk: Multiple 3D libraries that may have version conflicts
- Impact: 3D visualizations could break
- Migration plan: Pin versions and monitor for breaking changes

**AI SDK Dependencies:**
- Risk: Rapidly changing AI SDKs (@ai-sdk/* packages)
- Impact: Chat functionality could break
- Migration plan: Regular dependency updates and compatibility testing

## Missing Critical Features

**Error Recovery:**
- Problem: Limited automatic error recovery mechanisms
- Blocks: Graceful degradation when services fail

**Performance Monitoring:**
- Problem: No performance metrics or monitoring
- Blocks: Cannot identify performance issues in production

**Test Coverage for API Routes:**
- Problem: API routes lack comprehensive test coverage
- Blocks: Cannot ensure API reliability during changes

## Test Coverage Gaps

**API Routes:**
- What's not tested: Authentication flows, error scenarios, edge cases
- Files: All files in `app/api/` directory
- Risk: API failures could go unnoticed
- Priority: High

**Audio Engine Components:**
- What's not tested: Cross-browser compatibility, error recovery, state transitions
- Files: `components/music-player/engine/` directory
- Risk: Audio playback failures across different devices
- Priority: High

**Integration Tests:**
- What's not tested: End-to-end user flows, component integration
- Files: Missing integration test suite
- Risk: Component interaction failures
- Priority: Medium

---

*Concerns audit: 2026-01-27*