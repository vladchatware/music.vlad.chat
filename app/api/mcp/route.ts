import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import { tracks, users, playlists, likes, Track } from "../../../soundcloud"
import { playbackDebugServer as playbackDebug } from "@/lib/playbackDebugServer"
import { fetchQuery } from "convex/nextjs"
import { api } from "../../../convex/_generated/api"
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'
import { searchTrackCandidates } from '@/lib/server/soundcloudCandidateSearch'
import { wrapMcpServerWithSentry } from '@sentry/node'

const MIN_PLAYABLE_TRACK_DURATION_MS = 90_000
const MAX_PLAYABLE_TRACK_DURATION_MS = 10 * 60 * 1000

const isTransitionSafeTrack = (track: Track) => {
  if (track.streamable !== true) return false
  const duration = track.duration
  if (!Number.isFinite(duration)) return false
  return duration >= MIN_PLAYABLE_TRACK_DURATION_MS && duration <= MAX_PLAYABLE_TRACK_DURATION_MS
}

// Helper to get user's SoundCloud token if authenticated
const getUserToken = async (): Promise<string | undefined> => {
  try {
    const token = await convexAuthNextjsToken()
    if (token) {
      return await fetchQuery(api.users.soundcloudToken, {}, { token }) ?? undefined
    }
  } catch {
    // User not authenticated, will use server credentials
  }
  return undefined
}

const handler = createMcpHandler(
  (server) => {
    const recordContent = process.env.AI_TELEMETRY_RECORD_CONTENT === 'true'
    wrapMcpServerWithSentry(server, {
      recordInputs: recordContent,
      recordOutputs: recordContent,
    })

    server.tool(
      'users',
      'List users',
      {
        q: z.string().optional(),
        ids: z.string().optional(),
        urns: z.string().optional(),
        limit: z.string().optional(),
      },
      async (query) => {
        const userToken = await getUserToken()
        const res = await users(query, userToken)
        const list = Array.isArray(res) ? res : res?.collection ?? []
        const payload = list
          .map(({ id, username, full_name }) => `${full_name ?? username}:${id}:${username}`)
          .join(',\n')

        return {
          content: [{
            type: "text",
            text: payload || 'No users found'
          }]
        }
      })

    server.tool(
      'tracks',
      'Search beyond the user\'s likes for new or similar tracks. Automatically broadens over-constrained searches. Copy every dj_state.playedTrackIds value into exclude_ids so only fresh candidates are returned.',
      {
        q: z.string(),
        limit: z.union([z.string(), z.number()]).optional(),
        genres: z.string().optional(),
        tags: z.string().optional(),
        bpm: z.object({
          from: z.string().optional(),
          to: z.string().optional()
        }).optional(),
        duration: z.object({
          from: z.string().optional().describe("Minimum track duration in milliseconds (e.g., 120000 for 2 minutes)"),
          to: z.string().optional().describe("Maximum track duration in milliseconds (e.g., 300000 for 5 minutes)")
        }).optional(),
        created_at: z.object({
          from: z.string().optional(),
          to: z.string().optional()
        }).optional(),
        exclude_ids: z.array(z.number().int().positive()).max(64).optional()
      }, async (query) => {
        const userToken = await getUserToken()
        const requestedLimit = Math.max(1, Math.min(12, Number.parseInt(String(query.limit ?? "12"), 10) || 12))
        const search = async (candidateQuery: Record<string, unknown>) => {
          const res = await tracks({
            q: String(candidateQuery.q ?? query.q),
            genres: typeof candidateQuery.genres === 'string' ? candidateQuery.genres : undefined,
            tags: typeof candidateQuery.tags === 'string' ? candidateQuery.tags : undefined,
            'bpm[from]': query.bpm?.from,
            'bpm[to]': query.bpm?.to,
            'duration[from]': query.duration?.from,
            'duration[to]': query.duration?.to,
            'created_at[from]': query.created_at?.from,
            'created_at[to]': query.created_at?.to,
          }, userToken)
          return (Array.isArray(res) ? res : res?.collection ?? []) as Track[]
        }
        const streamableTracks = await searchTrackCandidates({
          query: { q: query.q, genres: query.genres, tags: query.tags },
          search,
          isPlayable: isTransitionSafeTrack,
          excludeIds: query.exclude_ids,
          desiredCount: requestedLimit,
        })
        const payload = streamableTracks.slice(0, requestedLimit).map(track => {
          const artist = track.user?.full_name ?? track.user?.username ?? 'Unknown'
          const followers = track.user?.followers_count ?? 0
          const hints: string[] = []
          if (track.bpm) hints.push(`${track.bpm} BPM`)
          if (track.genre) hints.push(track.genre)
          if (track.key_signature) hints.push(`key: ${track.key_signature}`)
          if (track.duration) hints.push(`${Math.round(track.duration / 1000)}s`)
          if (followers > 0) hints.push(`${followers} followers`)
          const hintsStr = hints.length > 0 ? ` (${hints.join(', ')})` : ''
          return `${track.id} ${artist} - ${track.title}${hintsStr}`
        }).join('\n')

        return {
          content: [{
            type: "text",
            text: payload || 'No tracks found'
          }]
        }
      })

    server.tool(
      'playlists',
      'List playlists',
      {
        q: z.string().optional(),
        limit: z.string().optional(),
      }, async (query) => {
        const userToken = await getUserToken()
        const res = await playlists(query, userToken)
        const list = Array.isArray(res) ? res : res?.collection ?? []
        const payload = list
          .map(({ id, title, user }) => `${user?.full_name ?? user?.username}:${id}:${title}`)
          .join(',\n')

        return ({
          content: [{ type: "text", text: payload || 'No playlists found' }]
        })
      })

    server.tool(
      'likes',
      'Get user liked tracks as taste seeds and candidates. Copy every dj_state.playedTrackIds value into exclude_ids so returned candidates are fresh. Mixed liked/similar requests also require tracks search.',
      {
        limit: z.union([z.string(), z.number()]).optional().default('20'),
        exclude_ids: z.array(z.number().int().positive()).max(64).optional(),
      },
      async ({ limit, exclude_ids }) => {
        const startedAt = Date.now()
        const userToken = await getUserToken()
        const effectiveUserId = process.env.SOUNDCLOUD_USER_ID
        if (!effectiveUserId) {
          return {
            content: [{
              type: "text",
              text: "SOUNDCLOUD_USER_ID is not configured."
            }]
          }
        }
        const requestedLimit = Number.parseInt(String(limit ?? '20'), 10)
        const normalizedLimit =
          Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(Math.max(requestedLimit, 8), 30)
            : 20
        // Fetch a bounded likes window to reduce transition-time latency.
        const fetchLimit = Math.min(Math.max(normalizedLimit * 3, 40), 120)
        playbackDebug("mcp.likes.begin", {
          requestedLimit: limit ?? null,
          normalizedLimit,
          fetchLimit,
          hasUserToken: Boolean(userToken),
        })
        const res = await likes(effectiveUserId, { limit: String(fetchLimit) }, userToken)

        // Filter to transition-safe tracks, then shuffle
        const excludedIds = new Set(exclude_ids ?? [])
        const streamableTracks = res.filter(
          (track) => isTransitionSafeTrack(track) && !excludedIds.has(track.id),
        )
        const shuffled = streamableTracks
          .map(value => ({ value, sort: Math.random() }))
          .sort((a, b) => a.sort - b.sort)
          .map(({ value }) => value)
          .slice(0, normalizedLimit)

        const payload = shuffled.map(track => {
          const artist = track.user?.full_name ?? track.user?.username ?? 'Unknown'
          const hints: string[] = []
          if (track.bpm) hints.push(`${track.bpm} BPM`)
          if (track.genre) hints.push(track.genre)
          if (track.key_signature) hints.push(`key: ${track.key_signature}`)
          if (track.duration) hints.push(`${Math.round(track.duration / 1000)}s`)
          const hintsStr = hints.length > 0 ? ` (${hints.join(', ')})` : ''
          return `${track.id} ${artist} - ${track.title}${hintsStr}`
        }).join('\n')

        playbackDebug("mcp.likes.done", {
          requestedLimit: limit ?? null,
          normalizedLimit,
          fetchedCount: res.length,
          streamableCount: streamableTracks.length,
          returnedCount: shuffled.length,
          elapsedMs: Date.now() - startedAt,
        })

        return {
          content: [{
            type: "text",
            text: payload || 'No liked tracks found'
          }]
        }
      })

  },
  {
    serverInfo: {
      name: 'SoundCloud',
      version: '0.0.2'
    }
  },
  { basePath: '/api' },
);

export { handler as GET, handler as POST, handler as DELETE };
