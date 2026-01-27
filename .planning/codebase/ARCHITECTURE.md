# Architecture

**Analysis Date:** 2026-01-27

## Pattern Overview

**Overall:** Next.js 15 App Router with Convex backend and React Three.js frontend

**Key Characteristics:**
- Full-stack TypeScript application with serverless API routes
- Real-time database backend via Convex with authentication
- 3D music player interface using React Three.js and professional DJ engine
- AI-powered music recommendations with OpenAI integration
- Stripe payment processing for premium features

## Layers

**Presentation Layer:**
- Purpose: React components and 3D visualization
- Location: `app/`, `components/`
- Contains: Next.js pages, React components, Three.js scenes, UI overlays
- Depends on: State management layer, API layer
- Used by: End users

**Business Logic Layer:**
- Purpose: Audio processing, DJ transitions, AI recommendations
- Location: `lib/dj/`, `lib/ai.ts`
- Contains: DJ engine, beatmatching, energy analysis, prompt engineering
- Depends on: Data access layer, external APIs
- Used by: Presentation layer

**Data Access Layer:**
- Purpose: Database operations and external API integration
- Location: `convex/`, `lib/`
- Contains: Database schema, user management, Stripe integration, SoundCloud API
- Depends on: Convex backend, external services
- Used by: Business logic layer, API routes

**API Layer:**
- Purpose: HTTP endpoints and streaming services
- Location: `app/api/`
- Contains: Chat API, audio processing, authentication, payment processing
- Depends on: Business logic layer, data access layer
- Used by: Frontend components, external clients

## Data Flow

**Music Playback Flow:**

1. User selects track via 3D interface (`components/music-player/`)
2. Track metadata fetched from SoundCloud (`lib/soundcloud.ts`)
3. Audio stream initialized through DJ engine (`lib/dj/engine/`)
4. Beatmatching and transition analysis performed (`lib/dj/`)
5. 3D visualization updated based on audio analysis (`components/music-player/Scene.tsx`)

**AI Chat Flow:**

1. User sends message to chat API (`app/api/chat/route.ts`)
2. Token limits checked via Convex user data
3. MCP client created for tool access
4. OpenAI processes message with DJ system prompt (`lib/ai.ts`)
5. Response streamed back with music recommendations
6. Usage tracked and tokens deducted

**Authentication Flow:**

1. Middleware intercepts all routes (`middleware.ts`)
2. Convex Auth handles authentication state
3. User data loaded in layout provider (`app/layout.tsx`)
4. Protected routes check auth status via hooks

## Key Abstractions

**DJ Engine:**
- Purpose: Professional DJ transition system
- Examples: `lib/dj/engine/`, `lib/dj/types.ts`
- Pattern: Deterministic state machine with immutable types

**Music Player State:**
- Purpose: Centralized playback and transition management
- Examples: `components/music-player/store/useMusicPlayerStore.ts`
- Pattern: Zustand store with shallow selectors

**Audio Analysis:**
- Purpose: Real-time audio feature extraction
- Examples: `lib/analyzers/`, `components/music-player/engine/useAudioAnalysis.ts`
- Pattern: Web Audio API with custom analysis pipelines

## Entry Points

**Root Layout:**
- Location: `app/layout.tsx`
- Triggers: All page requests
- Responsibilities: Authentication provider, HTML structure, Convex client setup

**Main Page:**
- Location: `app/page.tsx`
- Triggers: Root URL access
- Responsibilities: Music player initialization with default track

**Chat API:**
- Location: `app/api/chat/route.ts`
- Triggers: AI chat requests
- Responsibilities: Token validation, AI processing, tool execution

**Audio APIs:**
- Location: `app/api/audio/`
- Triggers: Speech synthesis, transcription requests
- Responsibilities: OpenAI audio processing

## Error Handling

**Strategy:** Layered error boundaries with graceful degradation

**Patterns:**
- API routes return appropriate HTTP status codes
- React error boundaries catch component failures
- Convex handles database errors automatically
- Authentication middleware protects routes

## Cross-Cutting Concerns

**Logging:** Convex built-in logging + console for development
**Validation:** Zod schemas for API input validation
**Authentication:** Convex Auth with Stripe customer integration
**Rate Limiting:** Token-based usage tracking in Convex

---

*Architecture analysis: 2026-01-27*