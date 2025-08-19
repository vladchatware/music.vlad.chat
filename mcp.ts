import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { tracks } from "./soundcloud"

const server = new McpServer({
    name: 'Soundcloud',
    version: '0.0.2'
}, {
    capabilities: {tools: {}}
})

server.tool('users', { query: z.string() }, async ({ query }) => {
    // TODO - use soundcloud.users
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
    const res = await tracks({
    q: query.q,
    genres: query.genres,
    tags: query.tags,
    'bpm[from]': query.bpm?.from,
    'bpm[to]': query.bpm?.to,
    'duration[from]': query.duration?.from,
    'duration[to]': query.duration?.to
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
    // TODO - use soundcloud.playlists
    const res = await fetch('https://api.soundcloud.com/tracks?q=FrutigerAero')
    const payload = await res.json()
    console.log(payload)
    return ({
        content: [{ type: "text", text: "https://api.soundcloud.com/tracks/13692671" }]
    })
})

export default server