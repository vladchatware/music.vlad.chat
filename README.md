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
- **FFT Analyzer** - Real-time frequency analysis
- **Web Audio API** - Audio playback and analysis

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
```

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
