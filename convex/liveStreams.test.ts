/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { createHmac } from "node:crypto";

import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

describe("live stream crowd", () => {
  it("creates a preview session when simulating before going live", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Streamer" }));
    const asStreamer = t.withIdentity({ subject: userId });

    await asStreamer.mutation(api.liveStreams.simulateComment, {
      sessionKey: "session_preview_123",
      username: "preview_dancer",
      text: "🔥",
    });

    expect(await t.query(api.liveStreams.listParticipants, {
      sessionKey: "session_preview_123",
    })).toEqual([
      expect.objectContaining({ username: "preview_dancer", commentCount: 1 }),
    ]);
    const session = await t.run((ctx) => ctx.db
      .query("liveSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", "session_preview_123"))
      .unique());
    expect(session).toMatchObject({ platformStatus: "live" });
    expect(session?.instagramAccountId).toBeUndefined();
  });

  it("turns first comments into participants and updates repeat commenters", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Streamer" }));
    const asStreamer = t.withIdentity({ subject: userId });
    await asStreamer.mutation(api.liveStreams.prepareSession, {
      sessionKey: "session_test_123",
      instagramAccountId: "17841400000000000",
    });

    await t.mutation(internal.liveStreams.ingestComments, {
      instagramAccountId: "17841400000000000",
      comments: [{
        commentId: "c1",
        instagramUserId: "viewer-1",
        username: "tiny_dancer",
        text: "hello",
      }],
    });
    await t.mutation(internal.liveStreams.ingestComments, {
      instagramAccountId: "17841400000000000",
      comments: [{
        commentId: "c2",
        instagramUserId: "viewer-1",
        username: "tiny_dancer",
        text: "🔥",
      }],
    });
    await t.mutation(internal.liveStreams.ingestComments, {
      instagramAccountId: "17841400000000000",
      comments: [{
        commentId: "c2",
        instagramUserId: "viewer-1",
        username: "tiny_dancer",
        text: "🔥",
      }],
    });

    const participants = await t.query(api.liveStreams.listParticipants, {
      sessionKey: "session_test_123",
    });
    expect(participants).toHaveLength(1);
    expect(participants[0]).toMatchObject({
      username: "tiny_dancer",
      lastComment: "🔥",
      commentCount: 2,
    });
  });

  it("ignores comments for accounts without active sessions", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(internal.liveStreams.ingestComments, {
      instagramAccountId: "999999",
      comments: [{ commentId: "c1", username: "nobody", text: "hello" }],
    })).resolves.toEqual({ accepted: 0 });
  });

  it("accepts signed Meta live comment webhooks end to end", async () => {
    process.env.INSTAGRAM_APP_SECRET = "meta-test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Streamer" }));
    await t.withIdentity({ subject: userId }).mutation(api.liveStreams.prepareSession, {
      sessionKey: "session_webhook_123",
      instagramAccountId: "17841400000000000",
    });
    const body = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "17841400000000000",
        changes: [{
          field: "live_comments",
          value: {
            id: "webhook-comment-1",
            from: { id: "viewer-9", username: "webhook_dancer" },
            text: "jump",
          },
        }],
      }],
    });
    const signature = createHmac("sha256", process.env.INSTAGRAM_APP_SECRET)
      .update(body)
      .digest("hex");
    const response = await t.fetch("/instagram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${signature}`,
      },
      body,
    });
    expect(response.status).toBe(200);
    const participants = await t.query(api.liveStreams.listParticipants, {
      sessionKey: "session_webhook_123",
    });
    expect(participants[0]).toMatchObject({ username: "webhook_dancer", lastComment: "jump" });
    delete process.env.INSTAGRAM_APP_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
  });
});
