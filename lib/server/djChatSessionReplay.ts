import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import { buildDJChatSessionManifest } from "@/lib/server/djChatSessionManifest";
import type { DJChatTurnSnapshot } from "@/lib/server/djChatSessionStore";

export interface DJChatSessionReplay {
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

function isSnapshot(value: unknown): value is DJChatTurnSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DJChatTurnSnapshot>;
  return record.schemaVersion === 1 &&
    typeof record.chatSessionId === "string" &&
    typeof record.captureId === "string" &&
    typeof record.turnId === "string" &&
    typeof record.model === "string" &&
    Array.isArray(record.messages);
}

export async function readDJChatSessionReplay(
  sessionKey: string,
): Promise<DJChatSessionReplay | null> {
  const replay = await fetchQuery(api.aiChatSessions.getReplay, { sessionKey });
  if (!replay) return null;

  const turns = (await Promise.all(replay.turns.map(async (turn) => {
    if (!turn.snapshotUrl) return null;
    const response = await fetch(turn.snapshotUrl, { cache: "no-store" });
    if (!response.ok) return null;
    const snapshot: unknown = await response.json();
    if (!isSnapshot(snapshot)) return null;
    return {
      captureKey: turn.captureKey,
      turnKey: turn.turnKey,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
      finishReason: turn.finishReason,
      isAborted: turn.isAborted,
      snapshot,
    };
  }))).filter((turn): turn is NonNullable<typeof turn> => turn !== null);

  return { session: replay.session, turns };
}

export async function readDJChatBenchRun(sessionKey: string) {
  const replay = await readDJChatSessionReplay(sessionKey);
  if (!replay || replay.turns.length === 0) return null;
  return {
    manifest: buildDJChatSessionManifest(replay),
    summary: {
      tokens: { input: 0, output: 0, total: 0 },
    },
  };
}

export async function listDJChatSessions() {
  return await fetchQuery(api.aiChatSessions.listRecent, { limit: 50 });
}
