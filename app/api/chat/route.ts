import { NextResponse, NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs';
import { ToolLoopAgent, convertToModelMessages, hasToolCall, stepCountIs, type ToolSet, type UIMessage } from 'ai';
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
import {
  createDJAgentStepPolicy,
  getDiscoveredTrackIds,
  getDJAgentMode,
  hasDJToolCall,
  hasDJToolCallAfterLatestRejectedPlayer,
  getLatestCandidateTrackIds,
  getLatestCommittedSetQueueTrackId,
  getLatestPlayedTrackIds,
  getLatestSetQueueTrackIds,
  getLatestSuccessfulPlayerTrackId,
} from '@/lib/server/djAgentPolicy';
import { getMcpClientRequest } from '@/lib/server/mcpClientRequest';
import { resolveDJModel } from '@/lib/server/djModel';
import { getDJLiveStateInstruction } from '@/lib/server/djLiveState';
import { createDJToolCallBudget } from '@/lib/server/djToolCallBudget';
import {
  classifyAgentTurnOutcome,
  DJ_PLAYER_DECISION_DEADLINE_MS,
  getDJAgentToolChoice,
  hasUsablePostPlayerAnalysis,
  MAX_DJ_AGENT_STEPS,
  getDJRequestTimeoutMs,
} from '@/lib/server/agentSessionLimit';
import { repairMissingStreamPartStarts } from '@/lib/server/repairModelStream';
import { getProductionDJModeInstruction } from '@/lib/dj/agentInstructions';
import { appendFinishedDJChatTurn } from '@/lib/server/djChatSessionStore';

function cleanCorrelation(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 128) : undefined;
}

function cleanConversationId(value: string | undefined) {
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

export async function POST(req: NextRequest) {
  const { messages, telemetry, djState } = await req.json()
  const chatSessionId = cleanCorrelation(telemetry?.chatSessionId);
  const turnId = cleanCorrelation(telemetry?.turnId);
  const agentSessionId = cleanCorrelation(telemetry?.agentSessionId);
  const agentSessionRevision = Number.isSafeInteger(telemetry?.agentSessionRevision)
    ? telemetry.agentSessionRevision as number
    : undefined;
  const activeTrackId = Number.isSafeInteger(telemetry?.activeTrackId)
    ? telemetry.activeTrackId as number
    : undefined;
  const agentSessionElapsedMs = Number.isFinite(telemetry?.agentSessionElapsedMs)
    ? Math.max(0, telemetry.agentSessionElapsedMs as number)
    : 0;
  const agentSessionRemainingMs = Number.isFinite(telemetry?.agentSessionRemainingMs)
    ? Math.max(0, telemetry.agentSessionRemainingMs as number)
    : undefined;

  const token = await convexAuthNextjsToken()
  if (!token) return new NextResponse('Unauthorized', { status: 401 })
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

  const mcpRequest = getMcpClientRequest(req)
  const transport = new StreamableHTTPClientTransport(mcpRequest.url, {
    requestInit: mcpRequest.requestInit,
  })
  const soundcloud = await createMCPClient({ transport })

  const soundcloudTools = await soundcloud.tools()
  const episodeContext = [messages, djState]
  const playedTrackIds = getLatestPlayedTrackIds(episodeContext)
  const queuedTrackIds = getLatestSetQueueTrackIds(djState)
  const committedTrackId = getLatestCommittedSetQueueTrackId(djState)
  const discoveryExcludedTrackIds = [...new Set([
    ...playedTrackIds,
    ...queuedTrackIds,
  ])]
  const bindPlayedExclusions = (remoteTool: (typeof soundcloudTools)[string]) => {
    if (!remoteTool?.execute || discoveryExcludedTrackIds.length === 0) return remoteTool
    const execute = remoteTool.execute
    return {
      ...remoteTool,
      execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
        const record = input && typeof input === 'object'
          ? input as Record<string, unknown>
          : {}
        return execute({ ...record, exclude_ids: discoveryExcludedTrackIds }, options)
      },
    }
  }
  const likesTool = soundcloudTools.likes ? bindPlayedExclusions(soundcloudTools.likes) : undefined
  const tracksTool = soundcloudTools.tracks ? bindPlayedExclusions(soundcloudTools.tracks) : undefined
  const discoveryTools = {
    ...(likesTool?.execute ? {
      likes: {
        ...likesTool,
        execute: createDJToolCallBudget({
          toolName: 'likes',
          maxCalls: 1,
          execute: likesTool.execute,
        }),
      },
    } : {}),
    ...(tracksTool?.execute ? {
      tracks: {
        ...tracksTool,
        execute: createDJToolCallBudget({
          toolName: 'tracks',
          maxCalls: 2,
          execute: tracksTool.execute,
        }),
      },
    } : {}),
  }
  const agentMode = getDJAgentMode(episodeContext)
  const liveStateInstruction = getDJLiveStateInstruction(djState)
  const acceptedPlayerTrackId = getLatestSuccessfulPlayerTrackId(messages)
  const preparedCandidatePool = agentMode === 'prepared_selection' || agentMode === 'post_player_preparation'
  const postPlayerPreparation = agentMode === 'post_player_preparation'
  const analysisScheduleWasRequired = postPlayerPreparation &&
    !hasDJToolCall(messages, 'schedule_track_analysis')
  const discoveredPlayerTrackIds = getDiscoveredTrackIds(messages)
    .filter((id) => !playedTrackIds.includes(id))
  const candidatePlayerTrackIds = [...new Set([
    ...getLatestCandidateTrackIds(djState),
    ...discoveredPlayerTrackIds,
  ])].filter((id) =>
    !playedTrackIds.includes(id) && id !== committedTrackId
  )
  const recoveryStateRefreshed = agentMode === 'recovery' &&
    hasDJToolCallAfterLatestRejectedPlayer(messages, 'dj_state')
  const hasSelectionEvidencePool = preparedCandidatePool || candidatePlayerTrackIds.length >= 2
  const localAgentTools = createDJAgentTools(undefined, {
    maxForegroundAnalyses: hasSelectionEvidencePool ? 4 : 1,
    playerCandidateIds: candidatePlayerTrackIds,
    compactPlayerSelection: agentMode === 'prepared_selection',
  })
  const requireMcpTool = (name: string) => {
    const remoteTool = soundcloudTools[name]
    if (!remoteTool?.execute) throw new Error(`Required MCP tool unavailable: ${name}`)
    return remoteTool
  }
  const trackAnalysisBase = requireMcpTool('track_analysis')
  const compareAnalysisBase = requireMcpTool('compare_track_analysis')
  const scheduleAnalysisBase = requireMcpTool('schedule_track_analysis')
  const trackAnalysisTool = {
    ...trackAnalysisBase,
    execute: createDJToolCallBudget({
      toolName: 'track_analysis',
      maxCalls: 1,
      execute: trackAnalysisBase.execute!,
    }),
  }
  const compareAnalysisTool = {
    ...compareAnalysisBase,
    execute: createDJToolCallBudget({
      toolName: 'compare_track_analysis',
      maxCalls: 1,
      execute: compareAnalysisBase.execute!,
    }),
  }
  const scheduleAnalysisTool = {
    ...scheduleAnalysisBase,
    execute: createDJToolCallBudget({
      toolName: 'schedule_track_analysis',
      maxCalls: 1,
      execute: scheduleAnalysisBase.execute!,
    }),
  }
  const agentTools = {
    ...(!liveStateInstruction || agentMode === 'recovery'
      ? { dj_state: localAgentTools.dj_state }
      : {}),
    player: localAgentTools.player,
    track_analysis: trackAnalysisTool,
    compare_track_analysis: compareAnalysisTool,
    schedule_track_analysis: scheduleAnalysisTool,
  }
  let postPlayerAnalysisScheduled = !analysisScheduleWasRequired
  const preparedPoolTools = { player: agentTools.player }
  const postPlayerAnalysisTool = {
    ...agentTools.track_analysis,
    description: `Analyze one prepared candidate for the transition after the queued track. Do not analyze the already accepted player track${acceptedPlayerTrackId ? ` ${acceptedPlayerTrackId}` : ''}.`,
    execute: async (
      input: unknown,
      options: Parameters<typeof agentTools.track_analysis.execute>[1],
    ) => {
      const trackId = input && typeof input === 'object'
        ? (input as { id?: unknown }).id
        : undefined
      if (trackId === acceptedPlayerTrackId) {
        return {
          status: 'rejected_selected_track' as const,
          trackId: String(trackId),
          instruction: 'Choose a different prepared candidate and call track_analysis once now.',
        }
      }
      return agentTools.track_analysis.execute(input, options)
    },
  }
  const postPlayerScheduleTool = {
    ...agentTools.schedule_track_analysis,
    execute: async (
      input: unknown,
      options: Parameters<typeof agentTools.schedule_track_analysis.execute>[1],
    ) => {
      const result = await agentTools.schedule_track_analysis.execute(input, options)
      postPlayerAnalysisScheduled = true
      return result
    },
  }
  const tools: ToolSet = postPlayerPreparation
    ? {
        track_analysis: postPlayerAnalysisTool,
        ...(analysisScheduleWasRequired
          ? { schedule_track_analysis: postPlayerScheduleTool }
          : {}),
      }
    : agentMode === 'recovery'
      ? { ...discoveryTools, ...agentTools }
    : preparedCandidatePool
      ? preparedPoolTools
      : { ...discoveryTools, ...agentTools }
  const stepPolicy = createDJAgentStepPolicy(messages, {
    hasInitialDJState: Boolean(liveStateInstruction),
  })
  const modeInstruction = getProductionDJModeInstruction(agentMode)
  const model = resolveDJModel(process.env.DJ_MODEL);
  const timeoutMs = getDJRequestTimeoutMs(agentSessionRemainingMs);
  const startedAt = performance.now();
  const turnStartedAt = new Date();
  const captureId = crypto.randomUUID();
  const replaySessionId = cleanConversationId(chatSessionId);
  const replayTurnId = cleanConversationId(turnId) ?? captureId;
  const traceContext = {
    chatSessionId,
    turnId,
    agentSessionId,
    agentSessionRevision,
    activeTrackId,
    agentSessionElapsedMs,
    agentSessionRemainingMs,
    model,
  };
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
    instructions: [systemMessage, modeInstruction, liveStateInstruction]
      .filter(Boolean)
      .join('\n\n'),
    tools,
    stopWhen: postPlayerPreparation
      ? [hasUsablePostPlayerAnalysis, stepCountIs(analysisScheduleWasRequired ? 3 : 2)]
      : [
          hasToolCall('player'),
          // End the transport response after discovery so the next continuation
          // can rebuild player with an exact candidate-ID schema.
          hasToolCall('likes'),
          hasToolCall('tracks'),
          stepCountIs(MAX_DJ_AGENT_STEPS),
        ],
    prepareStep: ({ stepNumber }) => {
      const boundedChoice = getDJAgentToolChoice({
        mode: agentMode,
        stepNumber,
        maxSteps: MAX_DJ_AGENT_STEPS,
        policyChoice: stepPolicy.nextRequiredTool(),
        elapsedMs: agentSessionElapsedMs + performance.now() - startedAt,
        decisionDeadlineMs: DJ_PLAYER_DECISION_DEADLINE_MS,
        recoveryStateRefreshed,
        postPlayerAnalysisScheduled,
        postPlayerScheduleWasRequired: analysisScheduleWasRequired,
      });
      return boundedChoice ? { toolChoice: boundedChoice } : undefined
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
      const toolNames = steps.flatMap((step) =>
        step.toolCalls.map(({ toolName }) => toolName)
      );
      const turnOutcome = classifyAgentTurnOutcome({
        stepCount: steps.length,
        maxSteps: MAX_DJ_AGENT_STEPS,
        toolNames,
        finishReason,
      });
      const logTurn = turnOutcome.outcome === 'failed'
        ? Sentry.logger.error
        : Sentry.logger.info;
      logTurn('AI DJ turn finished', {
        ...finishAttributes,
        outcome: turnOutcome.outcome,
        ...(turnOutcome.outcome === 'failed' ? { failure_reason: turnOutcome.reason } : {}),
        duration_ms: durationMs,
        step_count: steps.length,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        ...(turnId ? { turn_id: turnId } : {}),
      });
      Sentry.metrics.count(
        turnOutcome.outcome === 'failed' ? 'ai.dj.turn.failed' : 'ai.dj.turn.finished',
        1,
        {
          attributes: turnOutcome.outcome === 'failed'
            ? { ...finishAttributes, reason: turnOutcome.reason }
            : finishAttributes,
        },
      );
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
        outcome: turnOutcome.outcome,
        ...(turnOutcome.outcome === 'failed' ? { failureReason: turnOutcome.reason } : {}),
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
      abortSignal: timeoutMs
        ? AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)])
        : req.signal,
      experimental_transform: repairMissingStreamPartStarts(),
    });
    return result.toUIMessageStreamResponse({
      originalMessages: Array.isArray(messages) ? messages as UIMessage[] : [],
      sendSources: true,
      onFinish: async ({ messages: finishedMessages, finishReason, isAborted }) => {
        if (!replaySessionId) return;
        try {
          await appendFinishedDJChatTurn({
            token,
            snapshot: {
              schemaVersion: 1,
              chatSessionId: replaySessionId,
              captureId,
              turnId: replayTurnId,
              model,
              startedAt: turnStartedAt.toISOString(),
              completedAt: new Date().toISOString(),
              messages: finishedMessages,
              djState,
              telemetry: telemetry && typeof telemetry === 'object'
                ? telemetry as Record<string, unknown>
                : undefined,
              outcome: {
                finishReason,
                isAborted,
              },
            },
          });
        } catch (error) {
          playbackDebugServer('ai.dj.session.persistence_failed', {
            ...traceContext,
            captureId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
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
