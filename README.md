# Agentic mp3 player

An AI-powered virtual DJ application that uses OpenAI to curate and play music from SoundCloud, featuring immersive 3D visualizations powered by React Three Fiber.

## Overview

music.vlad.chat is a web application that combines AI music curation with real-time audio visualization. Users can interact with an AI DJ that selects and plays tracks from SoundCloud based on natural language requests. The application features stunning 3D visualizations that react to the audio in real-time.

## Features

- **AI-Powered Music Curation**: Chat with an AI DJ that understands music requests and plays tracks from SoundCloud
- **Real-Time Audio Visualization**: 3D visualizations powered by React Three Fiber that react to audio frequency data
- **SoundCloud Integration**: Seamless integration with SoundCloud for track discovery and playback
- **User Authentication**: Support for anonymous and SoundCloud OAuth authentication via Convex Auth
- **Payment Integration**: Stripe integration for purchasing credits/tokens
- **MCP (Model Context Protocol) Integration**: Uses MCP for enhanced AI capabilities
- **OBS Studio Integration**: Automatic recording start/stop for OBS Studio

## Tech Stack

### Frontend
- **Next.js 15** - React framework with App Router
- **React 19** - UI library
- **React Three Fiber** - 3D graphics library
- **React Three Drei** - Useful helpers for R3F
- **React Three UI Kit** - 3D UI components
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **Vercel AI SDK** - AI chat functionality

### Backend
- **Convex** - Backend-as-a-Service for database and real-time functionality
- **Convex Auth** - Authentication system
- **OpenAI** - AI model provider (GPT-5-mini)
- **Stripe** - Payment processing
- **Model Context Protocol (MCP)** - Enhanced AI capabilities

### Audio Processing
- **Superpowered WebAssembly** - Two-deck transport, decoding, time stretching, EQ, mixing, compression, and limiting
- **AudioWorklet** - Deterministic real-time render clock and final browser audio-device output
- **FFT Analyzer** - Real-time frequency analysis
- **Web Audio API** - Audio-device output and visualization taps
- **Essentia.js Worker** - Offline beat, key, energy, structure, semantic mood, vocal presence, and cue-point analysis

## DJ Analysis Worker

Track analysis uses Vercel Workflow as the durable queue and sole scheduler. Each workflow creates its Convex job, dispatches to the Bun analyzer, sleeps durably while the worker is busy or a retry is pending, and resumes through a webhook. Convex only stores cache, job state, and leases; neither Convex nor the worker polls for work. Worker requires FFmpeg and service-accessible SoundCloud tracks.

```env
DJ_ANALYSIS_QUEUE_ENABLED=true
NEXT_PUBLIC_DJ_ANALYSIS_ENABLED=true
ANALYSIS_SERVICE_SECRET=<shared-random-secret>
CONVEX_SITE_URL=https://<deployment>.convex.site
ANALYSIS_WORKER_URL=https://<analysis-worker>
# Used by analysis:queue-likes; defaults to http://localhost:3000
ANALYSIS_APP_URL=https://<app>
ANALYSIS_WORKER_CONCURRENCY=2
PORT=3001
```

Run locally:

```bash
bun run analysis:prepare-models
bun run analysis:worker
```

Run on worker machine behind a remotely managed Cloudflare Tunnel:

1. Copy `workers/track-analysis/.env.example` to `workers/track-analysis/.env` and fill it.
2. In Cloudflare Tunnel, map a public hostname to `http://analysis-worker:3001`.
3. Set Vercel `ANALYSIS_WORKER_URL` to that public `https://` hostname and use the same `ANALYSIS_SERVICE_SECRET`.
4. Start both containers:

```bash
bun run analysis:infra:up
```

Follow with `bun run analysis:infra:logs`; stop with `bun run analysis:infra:down`. The worker acknowledges accepted work immediately and reports completion through the workflow webhook, so analysis duration is not tied to Cloudflare's request timeout.

Semantic analysis uses overlapping 10-second MusiCNN windows with a 5-second hop, then overlap-weights mood and voice probabilities into four-bar musical segments. Model files are cached outside Git under `workers/track-analysis/models`. Set `ESSENTIA_MODEL_DIR` to use another location. Missing models degrade to structural analysis and add a diagnostic warning.

Queue every eligible liked track (paginated, batched, and idempotent):

```bash
bun run analysis:queue-likes
```

Build dedicated container with `Dockerfile.worker`. Include semantic weights only after accepting their license:

```bash
docker build -f Dockerfile.worker --build-arg ESSENTIA_MODELS_ACCEPT_LICENSE=true .
```

Deploy Convex schema/functions, Vercel app, and worker endpoint before enabling `NEXT_PUBLIC_DJ_ANALYSIS_ENABLED`. Configure same `ANALYSIS_SERVICE_SECRET` on app and worker.

Essentia.js uses AGPL-3.0. Downloaded MTG model weights use CC BY-NC-SA 4.0; obtain proprietary model licensing before commercial deployment.

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- Convex account and project
- OpenAI API key
- Stripe account (for payments)
- SoundCloud API credentials

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd music.vlad.chat
```

2. Install dependencies:
```bash
bun install
# or
npm install
```

3. Set up environment variables:
Create a `.env.local` file with the following variables:

```env
# Convex
CONVEX_DEPLOYMENT=<your-convex-deployment-url>
NEXT_PUBLIC_CONVEX_URL=<your-convex-url>

# OpenAI
OPENAI_API_KEY=<your-openai-api-key>

# Stripe
STRIPE_SECRET_KEY=<your-stripe-secret-key>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<your-stripe-publishable-key>

# Site URL
SITE_URL=http://localhost:3000

# SoundCloud (if needed)
SOUNDCLOUD_CLIENT_ID=<your-soundcloud-client-id>
SOUNDCLOUD_CLIENT_SECRET=<your-soundcloud-client-secret>

# Required for any non-local Superpowered deployment
NEXT_PUBLIC_SUPERPOWERED_LICENSE_KEY=<your-registered-superpowered-js-license>

# Sentry runtime (use the same DSN for browser, server, and edge)
NEXT_PUBLIC_SENTRY_DSN=<your-sentry-dsn>
SENTRY_DSN=<your-sentry-dsn>

# Sentry source maps (build-time; keep the auth token secret)
SENTRY_ORG=<your-sentry-org-slug>
SENTRY_PROJECT=<your-sentry-project-slug>
SENTRY_AUTH_TOKEN=<your-sentry-auth-token>
```

Superpowered's evaluation key is used only on localhost. It does not permit public deployment.
See [docs/superpowered-audio-engine.md](docs/superpowered-audio-engine.md) for engine architecture,
licensing, browser requirements, and transport API.

4. Set up Convex:
```bash
npx convex dev
```

5. Run the development server:
```bash
bun dev
# or
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
music.vlad.chat/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── audio/         # Audio processing endpoints
│   │   ├── chat/          # AI chat endpoint
│   │   ├── tracks/        # SoundCloud track endpoints
│   │   └── checkout_session/ # Stripe checkout
│   ├── tracks/            # Track detail pages
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Main page
├── components/            # React components
│   ├── Ring/              # Audio visualization rings
│   ├── visualizers/       # Visualization components
│   └── ...                # Other UI components
├── convex/                # Convex backend
│   ├── schema.ts          # Database schema
│   ├── auth.ts            # Authentication
│   └── users.ts           # User queries/mutations
├── lib/                   # Utility libraries
│   ├── ai.ts              # AI helper functions
│   ├── analyzers/         # Audio analyzers
│   ├── mappers/           # Coordinate mappers for visualizations
│   ├── soundcloud.ts      # SoundCloud integration
│   └── stripe.ts          # Stripe integration
└── public/                # Static assets
    └── assets/            # FFmpeg, SQLite, etc.
```

## Available Scripts

- `bun dev` - Start development server with Turbopack
- `bun build` - Build for production with Turbopack
- `bun start` - Start production server

## Playback diagnostics

Enable locally with `?mpDebug=1` or `localStorage.musicPlayerDebug = "true"`. Events remain
available in `window.__MUSIC_PLAYER_DEBUG__.events` and emit as Sentry logs and metrics. Events
include runtime session ID, chat session ID, AI turn ID, order, and elapsed time. AI generation and
deck events share correlation IDs, allowing one trace from prompt through player tool to transition
outcome.

`addPlaybackTelemetrySink()` in
`lib/playbackDebug.ts` forwards each structured entry to Sentry without changing DJ engine
instrumentation. AI SDK telemetry is enabled under
function ID `ai-dj-chat`; prompt/output recording remains off unless
`AI_TELEMETRY_RECORD_CONTENT=true` because chat content may contain private data.

## Key Features Explained

### AI Chat Interface
The application uses OpenAI's GPT-5-mini model to understand user music requests. The AI can:
- Understand natural language music requests (e.g., "Play some angel core genre")
- Search and select appropriate tracks from SoundCloud
- Use tools to play tracks automatically

### Audio Visualization
Real-time audio analysis using FFT (Fast Fourier Transform) creates dynamic 3D visualizations:
- **BaseDiffusedRing**: A ring visualization that reacts to audio frequencies
- **Coordinate Mappers**: Map audio data to 3D coordinates
- **FFT Analyzer**: Extracts frequency data from audio in real-time

### Authentication & Credits
- **Anonymous Users**: Limited trial messages
- **Authenticated Users**: SoundCloud OAuth with token-based credits
- **Payment System**: Stripe integration for purchasing additional credits

## API Routes

- `POST /api/chat` - AI chat endpoint
- `GET /api/tracks/[id]` - Fetch track metadata
- `GET /api/tracks/[id]/stream` - Stream track audio
- `POST /api/audio/speech` - Text-to-speech
- `POST /api/audio/transcriptions` - Speech-to-text
- `POST /api/checkout_session` - Create Stripe checkout session

## Development

The project uses:
- **Turbopack** for fast development builds
- **TypeScript** for type safety
- **Convex** for real-time backend functionality
- **React Three Fiber** for 3D graphics
