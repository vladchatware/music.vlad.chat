import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import { tracks, users, playlists, likes, Track } from "../../../soundcloud"

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
        const res = await users(query)
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
      'List tracks',
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
        })

        const list: Track[] = Array.isArray(res) ? res : res?.collection ?? []
        const payload = list.map(track => {
          const artist = track.user?.full_name ?? track.user?.username ?? 'Unknown'
          const hints: string[] = []
          if (track.bpm) hints.push(`${track.bpm} BPM`)
          if (track.genre) hints.push(track.genre)
          if (track.key_signature) hints.push(`key: ${track.key_signature}`)
          if (track.duration) hints.push(`${Math.round(track.duration / 1000)}s`)
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
        const res = await playlists(query)
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
      'Get randomized list of liked songs with metadata for DJ mixing',
      {
        user_id: z.string().optional(),
        limit: z.string().optional().default('50'),
      },
      async ({ user_id, limit }) => {
        if (!user_id) user_id = process.env.SOUNDCLOUD_USER_ID
        // Fetch all likes (up to 200) then shuffle and limit the output
        const res = await likes(user_id, { limit: '200' })

        // Shuffle the results to avoid repetition
        const shuffled = res
          .map(value => ({ value, sort: Math.random() }))
          .sort((a, b) => a.sort - b.sort)
          .map(({ value }) => value)
          .slice(0, parseInt(limit || '50', 10))

        const payload = shuffled.map(track => {
          const hints: string[] = []
          if (track.bpm) hints.push(`${track.bpm} BPM`)
          if (track.genre) hints.push(track.genre)
          if (track.key_signature) hints.push(`key: ${track.key_signature}`)
          if (track.duration) hints.push(`${Math.round(track.duration / 1000)}s`)
          const hintsStr = hints.length > 0 ? ` (${hints.join(', ')})` : ''
          return `${track.id} ${track.title}${hintsStr}`
        }).join('\n')

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
