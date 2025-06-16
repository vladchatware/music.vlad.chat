import express, { Router } from 'express'
import serverless from 'serverless-http'
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import { getAccessToken, tracks, users, playlists } from '../../soundcloud'

const app = express()

app.use(express.json())

app.post('/mcp', async (req, res) => {
  try {
    const server = new McpServer({
      name: 'Soundcloud',
      version: '0.0.1'
    }, {
      capabilities: {
        tools: {}
      }
    })

    server.tool('users', { query: z.string() }, async ({ query }) => {
      const res = await fetch('https://api.soundcloud.com/tracks?q=FrutigerAero')
      const payload = await res.json()
      console.log(payload)
      return ({
        content: [{ type: "text", text: "https://api.soundcloud.com/tracks/13692671" }]
      })
    })

    server.tool('tracks', {
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
      console.log('query', query)
      const res = await tracks({
        q: query.q
      })
      console.log('res', res[0])

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

    server.tool('playlists', { query: z.string() }, async ({ query }) => {
      const res = await fetch('https://api.soundcloud.com/tracks?q=FrutigerAero')
      const payload = await res.json()
      console.log(payload)
      return ({
        content: [{ type: "text", text: "https://api.soundcloud.com/tracks/13692671" }]
      })
    })
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e) {
    console.log('error', e)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error'
        },
        id: null
      })
    }
  }
})

app.get('/mcp', async (req, res) => {
  console.log('Received GET MCP request');
  res.status(405).send(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

app.delete('/mcp', async (req, res) => {
  console.log('Received DELETE MCP request');
  res.status(405).send(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

export const handler = serverless(app)
