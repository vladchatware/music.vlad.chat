import { NextResponse, NextRequest } from 'next/server'
import { streamText, UIMessage, convertToModelMessages, experimental_createMCPClient, stepCountIs, smoothStream, ToolSet } from 'ai';
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openai } from '@ai-sdk/openai';
import { getAccessToken } from '../../../soundcloud';
import { systemMessage } from '../../../lib/ai';
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { api, internal } from '../../../convex/_generated/api';
import z from 'zod';

export async function POST(req: NextRequest) {
  const { messages } = await req.json()
  const authorization = await getAccessToken()
  const url = process.env.SITE_URL
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/api/mcp`))
  const notion = await experimental_createMCPClient({
    transport
  })

  const tools: ToolSet = {
    player: {
      description: "Play a song",
      inputSchema: z.object({
        id: z.number().describe("The id of a song")
      })
    }
  }

  const notionTools = await notion.tools() as ToolSet
  const result = streamText({
    model: openai('gpt-5-mini'),
    messages: convertToModelMessages(messages),
    tools: { ...tools, ...notionTools },
    stopWhen: stepCountIs(5),
    system: systemMessage,
    onFinish: async ({ usage, providerMetadata }) => {
      console.log(usage)
      // if (user.isAnonymous) {
      //   await fetchMutation(api.users.messages, {}, { token: await convexAuthNextjsToken() })
      // } else {
      //   await fetchMutation(api.users.usage, { usage, model: 'gpt-5-mini', provider: 'AI Gateway', providerMetadata }, { token: await convexAuthNextjsToken() })
      // }
    },
  })

  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true
  })
}
