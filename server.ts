import express from "express"
import fs from 'node:fs'
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { getAccessToken, tracks, users, playlists } from "./soundcloud"

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

app.post('/api/responses', async (req, res) => {
  const payload = await fetch(`https://api.openai.com/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(req.body)
  })

  const data = await payload.json()

  res.status(200).json(data)
})

app.post('/api/audio/speech', async (req, res) => {
  console.log(req.body)
  const payload = await fetch(`https://api.openai.com/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(req.body)
  })

  const arrayBuffer = await payload.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  res.setHeader('Content-Type', 'audio/mpeg');
  res.send(buffer);
})

// app.use((_, res, next) => {
//   res.set({
//     // "Cross-Origin-Opener-Policy": "same-origin",
//     // "Cross-Origin-Embedder-Policy": "require-corp",
//     "Cross-Origin-Resource-Policy": "cross-origin",
//     // "Origin-Agent-Cluster": "?1",
//     "Access-Control-Allow-Origin": "*",
//     // "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
//     // "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Range"
//   })
//   next()
// })

app.use(express.static('public'))

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html')
})

app.get('/tracks/:id', (req, res) => {
  const id = req.params.id || '692509783'

  const template = fs.readFileSync(`${__dirname}/public/index.html`)

  if (!template) return res.status(500).send('Error reading template')

  const payload = template.replace(/\{id\}/g, id)

  res.send(payload)
})

app.listen(3000, () => {
  console.log('Server running on port 3000')
})

