import { NextResponse, NextRequest } from 'next/server'
import { streamText, convertToModelMessages, hasToolCall, stepCountIs } from 'ai';
import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { systemMessage } from '../../../lib/ai';
import { fetchQuery } from "convex/nextjs"
import { api } from '../../../convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { createDJAgentTools } from '@/lib/server/djAgentTools';
import { checkDJAccess, recordDJUsage } from '@/lib/server/djAgentAccess';
import { isLocalDJBypass } from '@/lib/server/localDJBypass';
import { playbackDebugServer } from '@/lib/playbackDebugServer';

function cleanCorrelation(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 128) : undefined;
}

export async function POST(req: NextRequest) {
  const { messages, telemetry } = await req.json()
  const chatSessionId = cleanCorrelation(telemetry?.chatSessionId);
  const turnId = cleanCorrelation(telemetry?.turnId);

  const token = await convexAuthNextjsToken()
  const user = await fetchQuery(api.users.viewer, {}, { token })
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const localBypass = isLocalDJBypass(req)
  const denied = localBypass ? null : await checkDJAccess(user, token)
  if (denied) return new NextResponse(denied.message, { status: denied.status })

  const url = process.env.NEXT_PUBLIC_SITE_URL
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/api/mcp`))
  const soundcloud = await experimental_createMCPClient({ transport })

  const soundcloudTools = await soundcloud.tools()
  const discoveryTools = {
    ...(soundcloudTools.likes ? { likes: soundcloudTools.likes } : {}),
    ...(soundcloudTools.tracks ? { tracks: soundcloudTools.tracks } : {}),
  }
  const model = process.env.DJ_MODEL ?? 'openai/gpt-5.4-nano';
  const timeoutMs = Math.min(
    120_000,
    Math.max(15_000, Number.parseInt(process.env.DJ_AGENT_TIMEOUT_MS ?? '45000', 10) || 45_000),
  );
  const traceContext = { chatSessionId, turnId, model };
  playbackDebugServer('ai.dj.turn.started', {
    ...traceContext,
    messageCount: Array.isArray(messages) ? messages.length : 0,
  });
  const result = streamText({
    model,
    messages: convertToModelMessages(messages),
    tools: { ...discoveryTools, ...createDJAgentTools() },
    stopWhen: [hasToolCall('player'), stepCountIs(12)],
    abortSignal: AbortSignal.timeout(timeoutMs),
    system: systemMessage,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'ai-dj-chat',
      recordInputs: process.env.AI_TELEMETRY_RECORD_CONTENT === 'true',
      recordOutputs: process.env.AI_TELEMETRY_RECORD_CONTENT === 'true',
      metadata: {
        ...(chatSessionId ? { chatSessionId } : {}),
        ...(turnId ? { turnId } : {}),
      },
    },
    onError: ({ error }) => {
      playbackDebugServer('ai.dj.turn.failed', {
        ...traceContext,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    onFinish: async ({ usage, finishReason, steps }) => {
      playbackDebugServer('ai.dj.turn.finished', {
        ...traceContext,
        finishReason,
        stepCount: steps.length,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      });
      if (!localBypass) await recordDJUsage(user, token, model, usage);
    },
  })

  return result.toUIMessageStreamResponse({ sendSources: true })
}
