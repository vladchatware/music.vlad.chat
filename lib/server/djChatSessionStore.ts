import { fetchMutation } from "convex/nextjs";
import type { UIMessage } from "ai";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export interface DJChatTurnSnapshot {
  schemaVersion: 1;
  chatSessionId: string;
  captureId: string;
  turnId: string;
  model: string;
  startedAt: string;
  completedAt: string;
  messages: UIMessage[];
  djState?: unknown;
  telemetry?: Record<string, unknown>;
  outcome: {
    finishReason?: string;
    isAborted: boolean;
  };
}

function validStorageId(value: unknown): value is Id<"_storage"> {
  return typeof value === "string" && value.length > 0;
}

export async function appendFinishedDJChatTurn(input: {
  token: string;
  snapshot: DJChatTurnSnapshot;
}) {
  const uploadUrl = await fetchMutation(
    api.aiChatSessions.generateUploadUrl,
    {},
    { token: input.token },
  );
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.snapshot),
  });
  if (!upload.ok) {
    throw new Error(`AI chat snapshot upload failed: ${upload.status}`);
  }
  const result = await upload.json() as { storageId?: unknown };
  if (!validStorageId(result.storageId)) {
    throw new Error("AI chat snapshot upload returned no storage ID");
  }

  return await fetchMutation(
    api.aiChatSessions.appendFinishedTurn,
    {
      sessionKey: input.snapshot.chatSessionId,
      captureKey: input.snapshot.captureId,
      turnKey: input.snapshot.turnId,
      model: input.snapshot.model,
      snapshotStorageId: result.storageId,
      startedAt: Date.parse(input.snapshot.startedAt),
      completedAt: Date.parse(input.snapshot.completedAt),
      finishReason: input.snapshot.outcome.finishReason,
      isAborted: input.snapshot.outcome.isAborted,
    },
    { token: input.token },
  );
}
