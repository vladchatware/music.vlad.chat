# Technology Stack

**Analysis Date:** 2026-01-27

## Languages

**Primary:**
- TypeScript [5.x] - Used throughout the project for type safety
- JavaScript/Node.js - Runtime environment

**Secondary:**
- JSX/TSX - React component syntax
- Three.js/GLSL - 3D graphics and shaders

## Runtime

**Environment:**
- Node.js [20.x] - Server runtime
- Bun [latest] - Package manager and runtime

**Package Manager:**
- Bun [latest] - Primary package manager
- Lockfile: bun.lock (present)

## Frameworks

**Core:**
- Next.js [15] - Full-stack React framework with App Router
- React [19.1.0] - UI library
- Convex [1.27.5] - Backend as a Service for database and functions

**Testing:**
- Vitest [4.0.16] - Test runner
- @vitest/coverage-v8 [4.0.16] - Code coverage

**Build/Dev:**
- Tailwind CSS [4] - CSS framework and styling
- Turbopack - Next.js bundler (experimental)

## Key Dependencies

**Critical:**
- @ai-sdk/openai [2.0.50] - OpenAI AI integration
- @ai-sdk/mcp [0.0.11] - Model Context Protocol
- @modelcontextprotocol/sdk [1.12.1] - MCP SDK
- @react-three/fiber [9.3.0] - React renderer for Three.js
- @react-three/drei [10.7.6] - Three.js helpers for React
- @react-three/rapier [2.1.0] - 3D physics engine
- stripe [19.1.0] - Payment processing

**Infrastructure:**
- convex [1.27.5] - Database and serverless functions
- jose [6.1.0] - JWT handling
- zustand [5.0.8] - State management

## Configuration

**Environment:**
- Environment variables in `.env.local`
- TypeScript configured with ES2017 target
- Path aliases: `@/*` maps to root directory

**Build:**
- `next.config.ts` - Next.js configuration
- `tsconfig.json` - TypeScript configuration
- `vitest.config.ts` - Test configuration

## Platform Requirements

**Development:**
- Node.js 20+
- Bun package manager
- Modern web browser with WebGL support

**Production:**
- Docker container support (oven/bun:latest)
- Convex deployment for backend
- Static hosting for Next.js frontend

---

*Stack analysis: 2026-01-27*