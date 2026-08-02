import {
  getDJAgentMode,
  type DJAgentMode,
} from "../../lib/server/djAgentPolicy";
import {
  playerToolInputSchema,
  resolvePreparedPlayerSelection,
} from "../../lib/dj";
import { computePlaybackAgentSessionDeadlineAtMs } from
  "../../components/music-player/chat/continuityIntent";

export const BROWSER_CONTINUATION_OVERRESEARCH_FAILURE_ID =
  "browser-continuation-overresearch";
export const PREPARED_SELECTION_LATENCY_FAILURE_ID =
  "prepared-selection-latency-deadline";
export const PREPARED_SELECTION_HOLDING_LOOP_FAILURE_ID =
  "prepared-selection-holding-loop";

export type PlaythroughEvent = {
  type:
    | "auto_cue"
    | "prepared_context_loaded"
    | "response_finished"
    | "context_serialized"
    | "player_call_incomplete"
    | "track_queued"
    | "deadline_exceeded";
  atSec: number;
  mode?: DJAgentMode;
  tool?: "likes" | "player";
};

export type BrowserPlaythroughResult = {
  failureId: string;
  status: "queued" | "dj_failed_to_choose" | "agent_holding_loop";
  responseCount: number;
  modeSequence: DJAgentMode[];
  queuedTrackId: number | null;
  queuedAtSec: number | null;
  deadlineAtSec: number;
  events: PlaythroughEvent[];
};

type ReconstructMode = (context: unknown) => DJAgentMode;

export function simulateBrowserPlaythrough(input: {
  trackDurationSec: number;
  autoCueAtSec: number;
  responseLatencyMs?: number;
  responseLatenciesMs?: number[];
  sessionMaxDurationMs?: number;
  preparedCandidateContext?: boolean;
  failureId?: string;
  candidateIds: number[];
  preparedPlayerInput?: unknown;
  reconstructMode?: ReconstructMode;
}): BrowserPlaythroughResult {
  const reconstructMode = input.reconstructMode ?? getDJAgentMode;
  const failureId = input.failureId ?? BROWSER_CONTINUATION_OVERRESEARCH_FAILURE_ID;
  const deadlineAtSec = computePlaybackAgentSessionDeadlineAtMs({
    nowMs: input.autoCueAtSec * 1_000,
    remainingSec: input.trackDurationSec - input.autoCueAtSec,
    durationSec: input.trackDurationSec,
    maxDurationMs: input.sessionMaxDurationMs,
  }) / 1_000;
  const events: PlaythroughEvent[] = [{ type: "auto_cue", atSec: input.autoCueAtSec }];
  const modeSequence: DJAgentMode[] = [];
  let context: unknown[] = input.preparedCandidateContext
    ? [{ performanceMemory: { candidateTrackIds: input.candidateIds } }]
    : [];
  if (input.preparedCandidateContext) {
    events.push({ type: "prepared_context_loaded", atSec: input.autoCueAtSec });
  }
  let nowSec = input.autoCueAtSec;
  let responseCount = 0;

  while (nowSec < deadlineAtSec && responseCount < 8) {
    const mode = reconstructMode(context);
    modeSequence.push(mode);
    responseCount += 1;
    const responseLatencyMs = input.responseLatenciesMs?.[responseCount - 1]
      ?? input.responseLatencyMs
      ?? 0;
    nowSec += responseLatencyMs / 1_000;
    if (nowSec >= deadlineAtSec) {
      events.push({ type: "deadline_exceeded", atSec: deadlineAtSec, mode });
      break;
    }

    if (mode === "prepared_selection") {
      const queuedTrackId = input.candidateIds[0] ?? null;
      if (input.preparedPlayerInput !== undefined) {
        const completePlayerInput = playerToolInputSchema.safeParse(
          input.preparedPlayerInput,
        ).success || Boolean(resolvePreparedPlayerSelection(
          input.preparedPlayerInput,
          input.candidateIds,
        ));
        if (!completePlayerInput) {
          events.push({ type: "player_call_incomplete", atSec: nowSec, mode, tool: "player" });
          return {
            failureId,
            status: "agent_holding_loop",
            responseCount,
            modeSequence,
            queuedTrackId: null,
            queuedAtSec: null,
            deadlineAtSec,
            events,
          };
        }
      }
      events.push({ type: "response_finished", atSec: nowSec, mode, tool: "player" });
      if (queuedTrackId !== null) {
        events.push({ type: "track_queued", atSec: nowSec, mode, tool: "player" });
        return {
          failureId,
          status: "queued",
          responseCount,
          modeSequence,
          queuedTrackId,
          queuedAtSec: nowSec,
          deadlineAtSec,
          events,
        };
      }
      break;
    }

    const output = input.candidateIds
      .map((id, index) => `${id} Mock Artist - Candidate ${index + 1} (180s)`)
      .join("\n");
    context.push({
      role: "assistant",
      parts: [{ type: "tool-likes", output }],
    });
    events.push({ type: "response_finished", atSec: nowSec, mode, tool: "likes" });
    context = JSON.parse(JSON.stringify(context)) as unknown[];
    events.push({ type: "context_serialized", atSec: nowSec, mode });
  }

  return {
    failureId,
    status: "dj_failed_to_choose",
    responseCount,
    modeSequence,
    queuedTrackId: null,
    queuedAtSec: null,
    deadlineAtSec,
    events,
  };
}

export function runPreparedSelectionHoldingLoopRegression() {
  const shared = {
    failureId: PREPARED_SELECTION_HOLDING_LOOP_FAILURE_ID,
    trackDurationSec: 151.641,
    autoCueAtSec: 4.63,
    responseLatenciesMs: [58_646],
    sessionMaxDurationMs: 70_000,
    candidateIds: [719940358, 1455949876],
    preparedCandidateContext: true,
  };
  const failureWitness = simulateBrowserPlaythrough({
    ...shared,
    preparedPlayerInput: {
      id: 719940358,
      performance: { energyArc: "preserve" },
    },
  });
  const current = simulateBrowserPlaythrough({
    ...shared,
    sessionMaxDurationMs: undefined,
    preparedPlayerInput: {
      id: 719940358,
      energyArc: "preserve",
      reason: "Keep the bright wistful lift without forcing a tempo jump.",
    },
  });
  return {
    failureId: PREPARED_SELECTION_HOLDING_LOOP_FAILURE_ID,
    failureWitness,
    current,
    passed:
      failureWitness.status === "agent_holding_loop" &&
      current.status === "queued" &&
      current.responseCount === 1,
  };
}

export function runPreparedSelectionLatencyRegression() {
  const shared = {
    failureId: PREPARED_SELECTION_LATENCY_FAILURE_ID,
    trackDurationSec: 151.641,
    autoCueAtSec: 4.23,
    responseLatenciesMs: [17_667, 52_379],
    sessionMaxDurationMs: 70_000,
    candidateIds: [101, 102],
  };
  const failureWitness = simulateBrowserPlaythrough(shared);
  const current = simulateBrowserPlaythrough({
    ...shared,
    sessionMaxDurationMs: undefined,
    responseLatenciesMs: [52_379],
    preparedCandidateContext: true,
  });
  return {
    failureId: PREPARED_SELECTION_LATENCY_FAILURE_ID,
    failureWitness,
    current,
    passed:
      failureWitness.status === "dj_failed_to_choose" &&
      current.status === "queued" &&
      current.responseCount === 1 &&
      current.modeSequence[0] === "prepared_selection",
  };
}

export function runBrowserContinuationRegression(): {
  failureId: typeof BROWSER_CONTINUATION_OVERRESEARCH_FAILURE_ID;
  failureWitness: BrowserPlaythroughResult;
  current: BrowserPlaythroughResult;
  passed: boolean;
} {
  const shared = {
    trackDurationSec: 151.641,
    autoCueAtSec: 4,
    responseLatencyMs: 24_000,
    candidateIds: [101, 102],
  };
  const failureWitness = simulateBrowserPlaythrough({
    ...shared,
    sessionMaxDurationMs: 70_000,
    reconstructMode: () => "fresh_discovery",
  });
  const current = simulateBrowserPlaythrough(shared);
  return {
    failureId: BROWSER_CONTINUATION_OVERRESEARCH_FAILURE_ID,
    failureWitness,
    current,
    passed:
      failureWitness.status === "dj_failed_to_choose" &&
      current.status === "queued",
  };
}
