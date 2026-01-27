# Codebase Structure

**Analysis Date:** 2026-01-27

## Directory Layout

```
music.vlad.chat/
├── app/                     # Next.js 15 App Router pages and API routes
│   ├── api/                 # Serverless API endpoints
│   │   ├── audio/           # Audio processing APIs (speech, transcription)
│   │   ├── chat/            # AI chat API with token management
│   │   ├── mcp/             # Model Context Protocol endpoint
│   │   ├── responses/       # Simple AI response API
│   │   ├── tracks/          # Music track management APIs
│   │   └── checkout_session/ # Stripe payment processing
│   ├── tracks/              # Dynamic track pages
│   ├── layout.tsx           # Root layout with auth providers
│   ├── page.tsx             # Main music player page
│   └── ConvexContextProvider.tsx # Convex client provider
├── components/              # React components
│   ├── music-player/        # Main music player components
│   ├── visualizers/         # Audio visualization components
│   └── Ring/                # 3D ring UI components
├── convex/                  # Convex backend configuration
│   ├── auth.config.ts       # Authentication configuration
│   ├── auth.ts              # Authentication logic
│   ├── schema.ts            # Database schema definition
│   └── users.ts             # User management functions
├── lib/                     # Shared utility libraries
│   ├── dj/                  # Professional DJ transition engine
│   │   ├── energy/          # Energy analysis algorithms
│   │   ├── engine/          # Core DJ engine logic
│   │   ├── eq/              # Equalization and filtering
│   │   ├── harmonic/        # Harmonic compatibility analysis
│   │   ├── structure/       # Song structure analysis
│   │   └── tempo/           # Beat and tempo detection
│   ├── analyzers/           # Audio analysis utilities
│   ├── mappers/             # Data transformation utilities
│   ├── ai.ts                # AI system prompts and utilities
│   ├── soundcloud.ts        # SoundCloud API integration
│   └── stripe.ts            # Stripe payment integration
├── public/                  # Static assets
└── .planning/               # Planning documentation
```

## Directory Purposes

**app/:** Next.js App Router structure with server-side rendering and API routes
- Contains: Pages, API endpoints, middleware, layout components
- Key files: `app/layout.tsx` (root layout), `app/page.tsx` (main entry)

**components/:** Reusable React components organized by feature
- Contains: UI components, 3D scenes, visualizations
- Key files: `components/music-player/MusicPlayerV2.tsx` (main player)

**convex/:** Backend database and authentication layer
- Contains: Schema definitions, auth config, data functions
- Key files: `convex/schema.ts` (database schema), `convex/users.ts` (user management)

**lib/:** Shared business logic and utilities
- Contains: DJ engine, API integrations, analysis tools
- Key files: `lib/dj/` (DJ transition system), `lib/ai.ts` (AI integration)

## Key File Locations

**Entry Points:**
- `app/page.tsx`: Main application entry point
- `app/layout.tsx`: Root layout with authentication
- `middleware.ts`: Route protection and auth middleware

**Configuration:**
- `package.json`: Dependencies and scripts
- `next.config.ts`: Next.js configuration
- `convex/schema.ts`: Database schema
- `convex/auth.config.ts`: Authentication setup

**Core Logic:**
- `lib/dj/engine/`: Professional DJ transition algorithms
- `lib/ai.ts`: AI chat system and prompts
- `components/music-player/`: Main music player components

**API Layer:**
- `app/api/chat/route.ts`: AI chat endpoint
- `app/api/audio/`: Audio processing endpoints
- `app/api/checkout_session/route.ts`: Payment processing

## Naming Conventions

**Files:**
- Component files: PascalCase (e.g., `MusicPlayerV2.tsx`)
- Utility files: camelCase (e.g., `soundcloud.ts`)
- API routes: `route.ts` in directory-based structure
- Test files: `.test.ts` or `.spec.ts` suffix

**Directories:**
- Features: kebab-case (e.g., `music-player`, `visualizers`)
- Libraries: lowercase (e.g., `dj`, `analyzers`, `mappers`)
- API routes: resource-based grouping (e.g., `audio/`, `tracks/`)

## Where to Add New Code

**New Feature:**
- Primary code: `components/[feature]/` or `lib/[feature]/`
- Tests: `lib/[feature]/__tests__/` or alongside components
- API routes: `app/api/[feature]/route.ts`

**New Component/Module:**
- Implementation: `components/[category]/[ComponentName].tsx`
- Styles: Co-located with component or via Tailwind classes
- Tests: `components/[category]/__tests__/[ComponentName].test.tsx`

**Utilities:**
- Shared helpers: `lib/utils/` or appropriate feature directory in `lib/`
- Types: Co-located with feature or in `lib/dj/types.ts` for DJ types
- Constants: `lib/constants/` or within feature modules

## Special Directories

**convex/_generated/:** Auto-generated Convex client code
- Purpose: Type-safe database access
- Generated: Yes
- Committed: No

**components/music-player/:** Main music player ecosystem
- Purpose: Complete music player implementation with 3D visualization
- Generated: No
- Committed: Yes

**lib/dj/:** Professional DJ transition system
- Purpose: Beatmatching, harmonic analysis, energy-based transitions
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-01-27*