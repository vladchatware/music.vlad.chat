import type { UIMessage } from "ai";

import { djPerformancePlanSchema, type DJPerformancePlan } from "@/lib/dj";
import type { DJChatTurnSnapshot } from "@/lib/server/djChatSessionStore";
import type {
  BenchAudibleSegment,
  BenchTimelineEvent,
  BenchTimelineManifest,
  BenchTimelineTrack,
  BenchTimelineTransition,
} from "@/scripts/dj-bench/timeline";

export interface StoredDJChatSession {
  session: {
    sessionKey: string;
    model: string;
    createdAt: number;
    updatedAt: number;
    turnCount: number;
  };
  turns: Array<{
    captureKey: string;
    turnKey: string;
    startedAt: number;
    completedAt: number;
    finishReason?: string;
    isAborted: boolean;
    snapshot: DJChatTurnSnapshot;
  }>;
}

type RecordValue = Record<string, unknown>;

type LiveTrack = {
  id: number;
  title: string;
  artist?: string;
  bpm?: number;
  durationSec: number;
  genre?: string;
};

type LiveState = {
  activeTrack: LiveTrack | null;
  activePositionSec: number;
  cuedTrack: LiveTrack | null;
  plannedStartSec: number | null;
  blendDurationSec: number | null;
};

const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function liveTrack(value: unknown): LiveTrack | null {
  const track = record(value);
  const id = finite(track?.id);
  if (!track || id === null || !Number.isSafeInteger(id) || id <= 0) return null;
  const durationSec = finite(track.duration) ?? 0;
  return {
    id,
    title: typeof track.title === "string" && track.title.trim()
      ? track.title
      : `Track ${id}`,
    ...(typeof track.artist === "string" && track.artist.trim()
      ? { artist: track.artist }
      : {}),
    ...(finite(track.bpm) !== null ? { bpm: finite(track.bpm)! } : {}),
    ...(typeof track.genre === "string" && track.genre.trim()
      ? { genre: track.genre }
      : {}),
    durationSec: durationSec > 0 ? durationSec : 1,
  };
}

function liveState(value: unknown): LiveState {
  const state = record(value);
  const activeDeck = record(state?.activeDeck);
  const cued = record(state?.cuedTrack);
  const plannedExit = record(state?.plannedExit);
  const transition = record(state?.transition);
  return {
    activeTrack: liveTrack(activeDeck?.track),
    activePositionSec: Math.max(0, finite(activeDeck?.positionSec) ?? 0),
    cuedTrack: liveTrack(cued?.track),
    plannedStartSec: finite(transition?.plannedStartSec) ?? finite(plannedExit?.atSec),
    blendDurationSec: finite(transition?.durationSec),
  };
}

function partRecord(part: UIMessage["parts"][number]): RecordValue {
  return part as unknown as RecordValue;
}

function toolName(part: UIMessage["parts"][number]): string | null {
  const value = partRecord(part);
  if (part.type === "dynamic-tool" && typeof value.toolName === "string") {
    return value.toolName;
  }
  return part.type.startsWith("tool-") ? part.type.slice(5) : null;
}

function toolCallId(part: UIMessage["parts"][number]): string | null {
  const value = partRecord(part).toolCallId;
  return typeof value === "string" ? value : null;
}

function performancePlan(parts: UIMessage["parts"]): {
  trackId: number;
  performance: DJPerformancePlan;
} | null {
  for (const part of [...parts].reverse()) {
    if (toolName(part) !== "player") continue;
    const input = record(partRecord(part).input);
    const trackId = finite(input?.id);
    if (!input || trackId === null || !Number.isSafeInteger(trackId) || trackId <= 0) continue;
    const nested = djPerformancePlanSchema.safeParse(input.performance);
    if (nested.success) return { trackId, performance: nested.data };
    const { id: _id, ...flatPlan } = input;
    const flat = djPerformancePlanSchema.safeParse(flatPlan);
    if (flat.success) return { trackId, performance: flat.data };
    const prepared = djPerformancePlanSchema.safeParse({
      energyArc: input.energyArc,
      exit: { anchor: "next_phrase" },
      entry: { anchor: "mix_in" },
      blend: {
        duration: { bars: 8 },
        crossfaderCurve: "equal_power",
        eq: "bass_swap",
      },
      tempo: { mode: "preserve" },
      reason: input.reason,
    });
    if (prepared.success) return { trackId, performance: prepared.data };
  }
  return null;
}

function messageText(messages: UIMessage[], role: UIMessage["role"]): string {
  return messages
    .filter((message) => message.role === role)
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function latestAssistant(messages: UIMessage[]) {
  return [...messages].reverse().find((message) => message.role === "assistant") ?? null;
}

function addTrack(target: Map<number, BenchTimelineTrack>, track: LiveTrack | null) {
  if (!track) return;
  target.set(track.id, track);
}

function buildEvents(
  stored: StoredDJChatSession,
  startMs: number,
): BenchTimelineEvent[] {
  const events: BenchTimelineEvent[] = [];
  const turnNumbers = new Map<string, number>();
  const previousAssistantParts = new Map<string, number>();
  let sequence = 0;

  const push = (event: Omit<BenchTimelineEvent, "id" | "sequence">) => {
    sequence += 1;
    events.push({ id: `event-${sequence}`, sequence, ...event });
  };

  stored.turns.forEach((turn) => {
    const turnNumber = turnNumbers.get(turn.turnKey) ?? turnNumbers.size + 1;
    turnNumbers.set(turn.turnKey, turnNumber);
    const assistant = latestAssistant(turn.snapshot.messages);
    const previousCount = previousAssistantParts.get(turn.turnKey) ?? 0;
    const parts = assistant?.parts ?? [];
    const deltaParts = parts.slice(Math.min(previousCount, parts.length));
    previousAssistantParts.set(turn.turnKey, parts.length);
    const startedSec = Math.max(0, (turn.startedAt - startMs) / 1_000);
    const completedSec = Math.max(startedSec, (turn.completedAt - startMs) / 1_000);

    push({
      type: "turn.started",
      setTimeSec: startedSec,
      wallTime: new Date(turn.startedAt).toISOString(),
      wallElapsedMs: turn.startedAt - startMs,
      turn: turnNumber,
      payload: {
        captureKey: turn.captureKey,
        turnKey: turn.turnKey,
        telemetry: turn.snapshot.telemetry ?? {},
      },
    });

    deltaParts.forEach((part) => {
      const name = toolName(part);
      if (!name) return;
      const value = partRecord(part);
      push({
        type: `tool.${name}`,
        setTimeSec: completedSec,
        wallTime: new Date(turn.completedAt).toISOString(),
        wallElapsedMs: turn.completedAt - startMs,
        turn: turnNumber,
        payload: {
          tool: name,
          toolCallId: toolCallId(part),
          input: value.input,
          output: value.output,
          state: value.state,
        },
      });
    });

    const text = deltaParts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const reasoningText = deltaParts
      .filter((part) => part.type === "reasoning")
      .map((part) => part.text)
      .join("\n");
    push({
      type: "agent.step",
      setTimeSec: completedSec,
      wallTime: new Date(turn.completedAt).toISOString(),
      wallElapsedMs: turn.completedAt - startMs,
      turn: turnNumber,
      step: stored.turns
        .filter((candidate) => candidate.turnKey === turn.turnKey && candidate.completedAt <= turn.completedAt)
        .length,
      ...(text ? { text } : {}),
      ...(reasoningText ? { reasoningText } : {}),
      payload: {
        captureKey: turn.captureKey,
        finishReason: turn.finishReason,
        isAborted: turn.isAborted,
        messages: turn.snapshot.messages,
        djState: turn.snapshot.djState,
      },
    });
  });

  return events;
}

function buildTimeline(stored: StoredDJChatSession, startMs: number, achievedDurationSec: number) {
  const tracks = new Map<number, BenchTimelineTrack>();
  const segments: BenchAudibleSegment[] = [];
  const transitions = new Map<string, BenchTimelineTransition>();
  let targetDurationSec = achievedDurationSec;
  let activeSegment: BenchAudibleSegment | null = null;

  stored.turns.forEach((turn, index) => {
    const state = liveState(turn.snapshot.djState);
    addTrack(tracks, state.activeTrack);
    addTrack(tracks, state.cuedTrack);
    const atSec = Math.max(0, (turn.startedAt - startMs) / 1_000);
    const nextAtSec = index + 1 < stored.turns.length
      ? Math.max(atSec, (stored.turns[index + 1]!.startedAt - startMs) / 1_000)
      : achievedDurationSec;

    if (state.activeTrack) {
      if (!activeSegment || activeSegment.trackId !== state.activeTrack.id) {
        if (activeSegment) {
          activeSegment.setEndSec = atSec;
          activeSegment.sourceEndSec = Math.min(
            tracks.get(activeSegment.trackId)?.durationSec ?? activeSegment.sourceEndSec,
            activeSegment.sourceStartSec + Math.max(0, atSec - activeSegment.setStartSec),
          );
        }
        activeSegment = {
          id: `track-${state.activeTrack.id}-${segments.length + 1}`,
          trackId: state.activeTrack.id,
          title: state.activeTrack.title,
          artist: state.activeTrack.artist,
          setStartSec: atSec,
          setEndSec: Math.max(atSec, nextAtSec),
          sourceStartSec: state.activePositionSec,
          sourceEndSec: Math.min(
            state.activeTrack.durationSec,
            state.activePositionSec + Math.max(0, nextAtSec - atSec),
          ),
          playbackRate: 1,
        };
        segments.push(activeSegment);
      } else {
        activeSegment.setEndSec = Math.max(activeSegment.setEndSec, nextAtSec);
        activeSegment.sourceEndSec = Math.min(
          state.activeTrack.durationSec,
          state.activePositionSec + Math.max(0, nextAtSec - atSec),
        );
      }
    }

    if (!state.activeTrack || !state.cuedTrack || state.plannedStartSec === null) return;
    const assistantParts = latestAssistant(turn.snapshot.messages)?.parts ?? [];
    const selected = performancePlan(assistantParts);
    if (!selected || selected.trackId !== state.cuedTrack.id) return;
    const setStartSec = atSec + Math.max(0, state.plannedStartSec - state.activePositionSec);
    const blendDurationSec = Math.max(0.1, state.blendDurationSec ?? 8);
    const setEndSec = setStartSec + blendDurationSec;
    const key = `${state.activeTrack.id}-${state.cuedTrack.id}`;
    transitions.set(key, {
      id: `transition-${key}`,
      fromTrackId: state.activeTrack.id,
      toTrackId: state.cuedTrack.id,
      acceptedAtSetSec: atSec,
      setStartSec,
      setEndSec,
      outgoingStartSec: state.plannedStartSec,
      incomingStartSec: selected.performance.entry.anchor === "time"
        ? selected.performance.entry.timeSec
        : 0,
      incomingPlaybackRate: 1,
      blendDurationSec,
      performance: selected.performance,
    });
    targetDurationSec = Math.max(targetDurationSec, setEndSec);
  });

  const planned = [...transitions.values()].sort((a, b) => a.setStartSec - b.setStartSec);
  planned.forEach((transition) => {
    const incoming = tracks.get(transition.toTrackId);
    if (!incoming) return;
    const sourceStartSec = transition.incomingStartSec;
    const setEndSec = transition.setStartSec + Math.max(0, incoming.durationSec - sourceStartSec);
    const observedIncoming = segments.find((segment) =>
      segment.trackId === incoming.id && segment.setStartSec >= transition.setStartSec,
    );
    if (observedIncoming) {
      observedIncoming.setStartSec = transition.setStartSec;
      observedIncoming.setEndSec = Math.max(observedIncoming.setEndSec, setEndSec);
      observedIncoming.sourceStartSec = sourceStartSec;
      observedIncoming.sourceEndSec = incoming.durationSec;
      observedIncoming.playbackRate = transition.incomingPlaybackRate;
    } else {
      segments.push({
        id: `track-${incoming.id}-planned-${segments.length + 1}`,
        trackId: incoming.id,
        title: incoming.title,
        artist: incoming.artist,
        setStartSec: transition.setStartSec,
        setEndSec,
        sourceStartSec,
        sourceEndSec: incoming.durationSec,
        playbackRate: transition.incomingPlaybackRate,
      });
    }
    targetDurationSec = Math.max(targetDurationSec, setEndSec);
    const outgoing = segments.find((segment) =>
      segment.trackId === transition.fromTrackId && segment.setStartSec <= transition.setStartSec,
    );
    if (outgoing) {
      outgoing.setEndSec = transition.setEndSec;
      outgoing.sourceEndSec = Math.min(
        tracks.get(outgoing.trackId)?.durationSec ?? outgoing.sourceEndSec,
        outgoing.sourceStartSec + transition.setEndSec - outgoing.setStartSec,
      );
    }
  });

  return {
    tracks: [...tracks.values()],
    audibleSegments: segments.sort((a, b) => a.setStartSec - b.setStartSec),
    transitions: planned,
    targetDurationSec,
  };
}

export function buildDJChatSessionManifest(stored: StoredDJChatSession): BenchTimelineManifest {
  const sorted: StoredDJChatSession = {
    session: stored.session,
    turns: [...stored.turns].sort((a, b) => a.startedAt - b.startedAt || a.completedAt - b.completedAt),
  };
  const startMs = Math.min(
    stored.session.createdAt,
    ...sorted.turns.map((turn) => turn.startedAt),
  );
  const finishMs = Math.max(
    stored.session.updatedAt,
    ...sorted.turns.map((turn) => turn.completedAt),
  );
  const achievedDurationSec = Math.max(0, (finishMs - startMs) / 1_000);
  const timeline = buildTimeline(sorted, startMs, achievedDurationSec);
  const firstMessages = sorted.turns[0]?.snapshot.messages ?? [];

  return {
    schemaVersion: 1,
    runId: stored.session.sessionKey,
    model: stored.session.model,
    provider: stored.session.model.split("/", 1)[0] || "unknown",
    scenario: "live-chat",
    prompt: messageText(firstMessages, "user"),
    startedAt: new Date(startMs).toISOString(),
    finishedAt: new Date(finishMs).toISOString(),
    targetDurationSec: timeline.targetDurationSec,
    achievedDurationSec,
    tracks: timeline.tracks,
    audibleSegments: timeline.audibleSegments,
    transitions: timeline.transitions,
    events: buildEvents(sorted, startMs),
  };
}
