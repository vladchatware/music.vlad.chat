# External Integrations

**Analysis Date:** 2026-01-27

## APIs & External Services

**AI & Language Services:**
- OpenAI - AI chat completion and audio services
  - SDK/Client: @ai-sdk/openai
  - Auth: OPENAI_API_KEY
  - Usage: GPT-5-mini for chat, speech synthesis, transcriptions

**Music Services:**
- SoundCloud - Music streaming and catalog
  - SDK/Client: Custom implementation in `soundcloud.ts`
  - Auth: CLIENT_ID, CLIENT_SECRET, SOUNDCLOUD_USER_ID
  - API: OAuth 2.0 with Bearer tokens
  - Endpoints: tracks, users, playlists, likes, stream

**Payment Services:**
- Stripe - Payment processing and customer management
  - SDK/Client: stripe [19.1.0]
  - Auth: STRIPE_SECRET_KEY
  - Usage: Customer creation, checkout sessions

## Data Storage

**Databases:**
- Convex - Serverless database and functions
  - Connection: CONVEX_DEPLOYMENT, NEXT_PUBLIC_CONVEX_URL
  - Client: convex [1.27.5]
  - Schema: Users, usage tracking, authentication tables

**File Storage:**
- No external file storage detected (likely handles audio streaming directly)

**Caching:**
- No dedicated caching service (uses built-in token caching for SoundCloud)

## Authentication & Identity

**Auth Provider:**
- Convex Auth - Custom authentication system
  - Implementation: @convex-dev/auth [0.0.90]
  - Configuration: `convex/auth.config.ts`
  - JWT handling with custom keys (JWT_PRIVATE_KEY, JWKS)
  - Anonymous user support with trial limits

## Monitoring & Observability

**Error Tracking:**
- None detected (no dedicated error tracking service)

**Logs:**
- Console-based logging
- Custom error messages in API routes

## CI/CD & Deployment

**Hosting:**
- Docker support with oven/bun:latest base image
- Netlify configuration detected in .gitignore
- Vercel configuration detected in .gitignore

**CI Pipeline:**
- None detected (likely manual or platform-based)

## Environment Configuration

**Required env vars:**
- STRIPE_SECRET_KEY - Stripe payment processing
- OPENAI_API_KEY - OpenAI services
- CLIENT_ID, CLIENT_SECRET - SoundCloud API
- SOUNDCLOUD_USER_ID - SoundCloud user ID fallback
- CONVEX_DEPLOYMENT - Convex backend connection
- NEXT_PUBLIC_CONVEX_URL - Public Convex URL
- NEXT_PUBLIC_SITE_URL - Application base URL
- JWT_PRIVATE_KEY - JWT signing key
- JWKS - JWT key verification

**Secrets location:**
- `.env.local` (development)
- Environment variables in production

## Webhooks & Callbacks

**Incoming:**
- Stripe webhooks (checkout sessions) - `app/api/checkout_session/route.ts`

**Outgoing:**
- SoundCloud API calls (OAuth flow and data fetching)
- OpenAI API calls (chat, speech, transcription)
- Stripe API calls (customer management)

---

*Integration audit: 2026-01-27*