import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import { tracks, users, playlists } from "../../../soundcloud"

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
          from: z.string().optional(),
          to: z.string().optional()
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

        const list = Array.isArray(res) ? res : res?.collection ?? []
        const payload = list
          .map(({ id, title, user }) => `${user?.full_name ?? user?.username}:${id}:${title}`)
          .join(',\n')

        return {
          content: [{
            type: "text",
            text: payload
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
