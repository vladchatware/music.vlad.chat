import { NextResponse, NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs';
import { ToolLoopAgent, convertToModelMessages, hasToolCall, stepCountIs, type ToolSet } from 'ai';
import { createMCPClient } from '@ai-sdk/mcp';
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { systemMessage } from '../../../lib/ai';
import { fetchQuery } from "convex/nextjs"
import { api } from '../../../convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { createDJAgentTools } from '@/lib/server/djAgentTools';
import { checkDJAccess, recordDJUsage } from '@/lib/server/djAgentAccess';
import { isLocalDJBypass } from '@/lib/server/localDJBypass';
import { playbackDebugServer } from '@/lib/playbackDebugServer';
import { createDJAgentStepPolicy, getLatestPlayedTrackIds } from '@/lib/server/djAgentPolicy';

function cleanCorrelation(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 128) : undefined;
}

function cleanConversationId(value: string | undefined) {
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

export async function POST(req: NextRequest) {
  const { messages, telemetry } = await req.json()
  const chatSessionId = cleanCorrelation(telemetry?.chatSessionId);
  const turnId = cleanCorrelation(telemetry?.turnId);

  const token = await convexAuthNextjsToken()
  const user = await fetchQuery(api.users.viewer, {}, { token })
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  Sentry.setUser({
    id: user._id,
    ...(user.email ? { email: user.email } : {}),
    ...(user.name ? { username: user.name } : {}),
  })
  Sentry.setConversationId(cleanConversationId(chatSessionId))

  const localBypass = isLocalDJBypass(req)
  const denied = localBypass ? null : await checkDJAccess(user, token)
  if (denied) return new NextResponse(denied.message, { status: denied.status })

  const url = process.env.NEXT_PUBLIC_SITE_URL
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/api/mcp`))
  const soundcloud = await createMCPClient({ transport })

  const soundcloudTools = await soundcloud.tools()
  const playedTrackIds = getLatestPlayedTrackIds(messages)
  const bindPlayedExclusions = (remoteTool: (typeof soundcloudTools)[string]) => {
    if (!remoteTool?.execute || playedTrackIds.length === 0) return remoteTool
    const execute = remoteTool.execute
    return {
      ...remoteTool,
      execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
        const record = input && typeof input === 'object'
          ? input as Record<string, unknown>
          : {}
        return execute({ ...record, exclude_ids: playedTrackIds }, options)
      },
    }
  }
  const discoveryTools = {
    ...(soundcloudTools.likes ? { likes: bindPlayedExclusions(soundcloudTools.likes) } : {}),
    ...(soundcloudTools.tracks ? { tracks: bindPlayedExclusions(soundcloudTools.tracks) } : {}),
  }
  const tools = { ...discoveryTools, ...createDJAgentTools() } satisfies ToolSet
  const stepPolicy = createDJAgentStepPolicy(messages)
  const model = process.env.DJ_MODEL ?? 'openai/gpt-5.4-nano';
  const timeoutMs = Math.min(
    120_000,
    Math.max(15_000, Number.parseInt(process.env.DJ_AGENT_TIMEOUT_MS ?? '45000', 10) || 45_000),
  );
  const startedAt = performance.now();
  const traceContext = { chatSessionId, turnId, model };
  const metricAttributes = {
    model,
    user_kind: user.isAnonymous ? 'anonymous' : 'authenticated',
  };
  Sentry.logger.info('AI DJ turn started', {
    ...metricAttributes,
    message_count: Array.isArray(messages) ? messages.length : 0,
    ...(turnId ? { turn_id: turnId } : {}),
  });
  Sentry.metrics.count('ai.dj.turn.started', 1, { attributes: metricAttributes });
  playbackDebugServer('ai.dj.turn.started', {
    ...traceContext,
    messageCount: Array.isArray(messages) ? messages.length : 0,
  });

  const recordTurnFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = performance.now() - startedAt;
    Sentry.logger.error('AI DJ turn failed', {
      ...metricAttributes,
      duration_ms: durationMs,
      error_type: error instanceof Error ? error.name : 'UnknownError',
      message,
      ...(turnId ? { turn_id: turnId } : {}),
    });
    Sentry.metrics.count('ai.dj.turn.failed', 1, { attributes: metricAttributes });
    Sentry.metrics.distribution('ai.dj.turn.duration', durationMs, {
      unit: 'millisecond',
      attributes: { ...metricAttributes, status: 'failed' },
    });
    playbackDebugServer('ai.dj.turn.failed', {
      ...traceContext,
      message,
    });
    void Sentry.flush(2_000);
  };

  const agent = new ToolLoopAgent({
    id: 'ai-dj-chat',
    model,
    instructions: systemMessage,
    tools,
    stopWhen: [hasToolCall('player'), stepCountIs(12)],
    prepareStep: () => {
      const toolChoice = stepPolicy.nextRequiredTool()
      return toolChoice ? { toolChoice } : undefined
    },
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
    onStepFinish: (step) => {
      stepPolicy.recordStep(step)
      const recordContent = process.env.AI_TELEMETRY_RECORD_CONTENT === 'true'
      const reasoningText = step.reasoningText?.slice(0, 4_000)
      playbackDebugServer('ai.dj.step.finished', {
        ...traceContext,
        explorationRequired: stepPolicy.explorationRequired,
        finishReason: step.finishReason,
        toolNames: step.toolCalls.map(({ toolName }) => toolName),
        reasoningAvailable: Boolean(reasoningText),
        ...(recordContent && reasoningText ? { reasoningText } : {}),
        ...(recordContent && step.text ? { text: step.text.slice(0, 4_000) } : {}),
      })
    },
    onFinish: async ({ totalUsage: usage, finishReason, steps }) => {
      const durationMs = performance.now() - startedAt;
      const finishAttributes = { ...metricAttributes, finish_reason: finishReason };
      Sentry.logger.info('AI DJ turn finished', {
        ...finishAttributes,
        duration_ms: durationMs,
        step_count: steps.length,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        ...(turnId ? { turn_id: turnId } : {}),
      });
      Sentry.metrics.count('ai.dj.turn.finished', 1, { attributes: finishAttributes });
      Sentry.metrics.distribution('ai.dj.turn.duration', durationMs, {
        unit: 'millisecond',
        attributes: { ...metricAttributes, status: 'finished' },
      });
      Sentry.metrics.distribution('ai.dj.turn.steps', steps.length, {
        attributes: finishAttributes,
      });
      Sentry.metrics.count('ai.dj.tokens.input', usage.inputTokens, {
        attributes: metricAttributes,
      });
      Sentry.metrics.count('ai.dj.tokens.output', usage.outputTokens, {
        attributes: metricAttributes,
      });
      playbackDebugServer('ai.dj.turn.finished', {
        ...traceContext,
        finishReason,
        stepCount: steps.length,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      });
      try {
        if (!localBypass) await recordDJUsage(user, token, model, usage);
      } finally {
        await Sentry.flush(2_000);
      }
    },
  })

  try {
    const result = await agent.stream({
      messages: await convertToModelMessages(messages),
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return result.toUIMessageStreamResponse({
      sendSources: true,
      onError: (error) => {
        recordTurnFailure(error);
        return 'AI DJ turn failed.';
      },
    });
  } catch (error) {
    recordTurnFailure(error);
    throw error;
  }
}
