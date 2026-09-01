/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";

import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

describe("AI chat session replay storage", () => {
  it("appends immutable finished turns and exposes replay publicly", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { name: "DJ" }));
    const snapshotStorageId = await t.run((ctx) => ctx.storage.store(
      new Blob([JSON.stringify({ schemaVersion: 1 })], { type: "application/json" }),
    ));
    const owner = t.withIdentity({ subject: ownerId });

    await owner.mutation(api.aiChatSessions.appendFinishedTurn, {
      sessionKey: "chat_session_1",
      captureKey: "capture_1",
      turnKey: "turn_1",
      model: "zai/glm-5.3-flash",
      snapshotStorageId,
      startedAt: 100,
      completedAt: 250,
      finishReason: "tool-calls",
      isAborted: false,
    });

    // Bench replay route is public: read without any identity.
    const replay = await t.query(api.aiChatSessions.getReplay, {
      sessionKey: "chat_session_1",
    });
    expect(replay).toMatchObject({
      session: {
        sessionKey: "chat_session_1",
        model: "zai/glm-5.3-flash",
        turnCount: 1,
      },
      turns: [{ captureKey: "capture_1", turnKey: "turn_1" }],
    });
    expect(await t.query(api.aiChatSessions.listRecent, { limit: 10 })).toHaveLength(1);
    await expect(t.query(api.aiChatSessions.listMine, { limit: 10 }))
      .rejects.toThrow("Authentication required");
  });

  it("deduplicates a retried capture and deletes its orphan upload", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { name: "DJ" }));
    const owner = t.withIdentity({ subject: ownerId });
    const firstStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["first"])));
    const retryStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["retry"])));
    const input = {
      sessionKey: "chat_session_2",
      captureKey: "capture_2",
      turnKey: "turn_2",
      model: "zai/glm-5.3-flash",
      startedAt: 100,
      completedAt: 250,
      isAborted: false,
    };

    const firstId = await owner.mutation(api.aiChatSessions.appendFinishedTurn, {
      ...input,
      snapshotStorageId: firstStorageId,
    });
    const retryId = await owner.mutation(api.aiChatSessions.appendFinishedTurn, {
      ...input,
      snapshotStorageId: retryStorageId,
    });

    expect(retryId).toBe(firstId);
    expect(await t.run((ctx) => ctx.db.system.get(retryStorageId))).toBeNull();
    expect((await owner.query(api.aiChatSessions.getReplay, {
      sessionKey: "chat_session_2",
    }))?.turns).toHaveLength(1);
  });

  it("requires authentication before allocating storage", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.aiChatSessions.generateUploadUrl, {}))
      .rejects.toThrow("Authentication required");
  });
});
