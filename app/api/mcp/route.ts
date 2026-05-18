import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import { tracks, users, playlists, likes, seedFromConvexSettings, Track } from "../../../soundcloud"
import { playbackDebugServer as playbackDebug } from "@/lib/playbackDebugServer"
import { fetchQuery } from "convex/nextjs"
import { api } from "../../../convex/_generated/api"
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'

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
      const accessToken = await fetchQuery(api.users.soundcloudToken, {}, { token }) ?? undefined
      seedFromConvexSettings(token)
      return accessToken
    }
  } catch {
    // User not authenticated, will use server credentials
  }
  return undefined
}

const handler = createMcpHandler(
  (server) => {
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
      'Search for tracks. Returns shuffled results. Prefer using "likes" tool first to get quality tracks matching user taste. Only use this for specific searches.',
      {
        q: z.string(),
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
        }).optional()
      }, async (query) => {
        const userToken = await getUserToken()
        const res = await tracks({
          q: query.q,
          genres: query.genres,
          tags: query.tags,
          'bpm[from]': query.bpm?.from,
          'bpm[to]': query.bpm?.to,
          'duration[from]': query.duration?.from,
          'duration[to]': query.duration?.to,
          'created_at[from]': query.created_at?.from,
          'created_at[to]': query.created_at?.to,
        }, userToken)

        const list: Track[] = Array.isArray(res) ? res : res?.collection ?? []
        // Filter to transition-safe tracks only.
        const streamableTracks = list.filter(isTransitionSafeTrack)
        const payload = streamableTracks.map(track => {
          const artist = track.user?.full_name ?? track.user?.username ?? 'Unknown'
          const followers = track.user?.followers_count ?? 0
          const hints: string[] = []
          if (track.bpm) hints.push(`${track.bpm} BPM`)
          if (track.genre) hints.push(track.genre)
          if (track.key_signature) hints.push(`key: ${track.key_signature}`)
          if (track.duration) hints.push(`${Math.round(track.duration / 1000)}s`)
          if (followers > 0) hints.push(`${followers} followers`)
          const hintsStr = hints.length > 0 ? ` (${hints.join(', ')})` : ''
          // Include description snippet for quality assessment
          const descSnippet = track.description ? ` | "${track.description.slice(0, 80).replace(/\n/g, ' ')}${track.description.length > 80 ? '...' : ''}"` : ''
          return `${track.id} ${artist} - ${track.title}${hintsStr}${descSnippet}`
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
      'PRIMARY SOURCE: Get user\'s liked tracks - these are pre-vetted quality tracks that match user taste. Use this FIRST before searching. Play directly from likes or use as reference for similar music.',
      {
        user_id: z.string().optional(),
        limit: z.string().optional().default('20'),
      },
      async ({ user_id, limit }) => {
        const startedAt = Date.now()
        const userToken = await getUserToken()
        const effectiveUserId = user_id ?? process.env.SOUNDCLOUD_USER_ID
        if (!effectiveUserId) {
          return {
            content: [{
              type: "text",
              text: "Missing user_id (and SOUNDCLOUD_USER_ID is not set)."
            }]
          }
        }
        const requestedLimit = Number.parseInt(limit ?? '20', 10)
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
        const streamableTracks = res.filter(isTransitionSafeTrack)
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
