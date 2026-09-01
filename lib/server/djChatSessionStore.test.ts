import { afterEach, describe, expect, it, vi } from "vitest";

const convex = vi.hoisted(() => ({ fetchMutation: vi.fn() }));

vi.mock("convex/nextjs", () => convex);

import { appendFinishedDJChatTurn } from "./djChatSessionStore";

afterEach(() => {
  convex.fetchMutation.mockReset();
  vi.unstubAllGlobals();
});

describe("DJ chat session persistence", () => {
  it("uploads one completed snapshot before appending its metadata", async () => {
    convex.fetchMutation
      .mockResolvedValueOnce("https://convex.example/upload")
      .mockResolvedValueOnce("turn-id");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ storageId: "storage-id" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(appendFinishedDJChatTurn({
      token: "convex-token",
      snapshot: {
        schemaVersion: 1,
        chatSessionId: "chat-1",
        captureId: "capture-1",
        turnId: "turn-1",
        model: "zai/glm-5.3-flash",
        startedAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:00:05.000Z",
        messages: [],
        outcome: { finishReason: "stop", isAborted: false },
      },
    })).resolves.toBe("turn-id");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://convex.example/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(convex.fetchMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        sessionKey: "chat-1",
        captureKey: "capture-1",
        turnKey: "turn-1",
        snapshotStorageId: "storage-id",
        startedAt: Date.parse("2026-09-01T00:00:00.000Z"),
        completedAt: Date.parse("2026-09-01T00:00:05.000Z"),
      }),
      { token: "convex-token" },
    );
  });

  it("does not append metadata when snapshot upload fails", async () => {
    convex.fetchMutation.mockResolvedValueOnce("https://convex.example/upload");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(appendFinishedDJChatTurn({
      token: "convex-token",
      snapshot: {
        schemaVersion: 1,
        chatSessionId: "chat-1",
        captureId: "capture-1",
        turnId: "turn-1",
        model: "zai/glm-5.3-flash",
        startedAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:00:05.000Z",
        messages: [],
        outcome: { isAborted: false },
      },
    })).rejects.toThrow("snapshot upload failed: 500");
    expect(convex.fetchMutation).toHaveBeenCalledTimes(1);
  });
});
