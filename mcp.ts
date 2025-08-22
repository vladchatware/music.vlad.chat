import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { tracks, playlists, users, TracksQuery } from "./soundcloud"

const server = new McpServer({
    name: 'Soundcloud',
    version: '0.0.2'
}, {
    capabilities: { tools: {} }
})

server.tool('users', { query: z.string() }, async (query) => {
    const res = await users({
        q: query.query,
        limit: '10'
    })

    const payload = res
        .map(({ id, username, full_name }) => ({ id, username, full_name }))
        .map(user => `${user.full_name}:${user.id}:${user.username}`)
        .join(',\n')

    return ({
        content: [{ type: "text", text: payload }]
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
    const fetchQuery: TracksQuery = {
        q: query.q,
    }
    if (query.genres) fetchQuery.genres = query.genres
    if (query.tags) fetchQuery.tags = query.tags
    // if (query.bpm) {
    //     if (query.bpm.from) fetchQuery['bpm[from]'] = query.bpm.from
    //     if (query.bpm.to) fetchQuery['bpm[to]'] = query.bpm.to
    // }
    // if (query.duration) {
    //     if (query.duration.from) fetchQuery['duration[from]'] = query.duration.from
    //     if (query.duration.to) fetchQuery['duration[to]'] = query.duration.to
    // }
    const res = await tracks(fetchQuery)

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

server.tool('playlists', { q: z.string() }, async (query) => {
    const res = await playlists({
        q: query.q,
    })

    const payload = res
        .map(({ id, title, user }) => ({ id, title, user }))
        .map(v => `${v.user.username}:${v.id}:${v.title}`)
        .join(',\n')

    return {
        content: [{
            type: "text",
            text: payload
        }]
    }
})

export default server