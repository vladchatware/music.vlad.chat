import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import { getAccessToken, tracks, users, playlists } from "../../../soundcloud"
import { NextResponse, NextRequest } from 'next/server'

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'users',
      'List users',
      { query: z.string() },
      async ({ query }) => {
        const res = await fetch('https://api.soundcloud.com/tracks?q=FrutigerAero')
        const payload = await res.json()
        console.log(payload)
        return ({
          content: [{ type: "text", text: "https://api.soundcloud.com/tracks/13692671" }]
        })
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
          q: query.q
        })

        const payload = res
          .map(({ id, title, description, user }) => ({ id, title, description, user }))
          .map(track => `${track.user.full_name}:${track.id}:${track.title}`)
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
      { query: z.string() }, async ({ query }) => {
        const res = await fetch('https://api.soundcloud.com/tracks?q=FrutigerAero')
        const payload = await res.json()
        console.log(payload)
        return ({
          content: [{ type: "text", text: "https://api.soundcloud.com/tracks/13692671" }]
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
