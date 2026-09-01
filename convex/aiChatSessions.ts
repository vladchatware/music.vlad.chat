import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";

const sessionValidator = v.object({
  sessionKey: v.string(),
  model: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  turnCount: v.number(),
});

const replayTurnValidator = v.object({
  captureKey: v.string(),
  turnKey: v.string(),
  startedAt: v.number(),
  completedAt: v.number(),
  finishReason: v.optional(v.string()),
  isAborted: v.boolean(),
  snapshotUrl: v.union(v.string(), v.null()),
});

async function authenticatedUserId(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Authentication required");
  return userId;
}

function validateKey(value: string, name: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 128) {
    throw new ConvexError(`Invalid ${name}`);
  }
}

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await authenticatedUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const appendFinishedTurn = mutation({
  args: {
    sessionKey: v.string(),
    captureKey: v.string(),
    turnKey: v.string(),
    model: v.string(),
    snapshotStorageId: v.id("_storage"),
    startedAt: v.number(),
    completedAt: v.number(),
    finishReason: v.optional(v.string()),
    isAborted: v.boolean(),
  },
  returns: v.id("aiChatTurns"),
  handler: async (ctx, args) => {
    const ownerId = await authenticatedUserId(ctx);
    validateKey(args.sessionKey, "session key");
    validateKey(args.captureKey, "capture key");
    validateKey(args.turnKey, "turn key");

    let session = await ctx.db
      .query("aiChatSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();

    if (session && session.ownerId !== ownerId) {
      throw new ConvexError("Session belongs to another user");
    }

    if (!session) {
      const sessionId = await ctx.db.insert("aiChatSessions", {
        sessionKey: args.sessionKey,
        ownerId,
        model: args.model,
        turnCount: 0,
        createdAt: args.startedAt,
        updatedAt: args.completedAt,
      });
      session = await ctx.db.get("aiChatSessions", sessionId);
    }
    if (!session) throw new ConvexError("Session creation failed");

    const existing = await ctx.db
      .query("aiChatTurns")
      .withIndex("by_session_capture", (q) =>
        q.eq("sessionId", session._id).eq("captureKey", args.captureKey),
      )
      .unique();
    if (existing) {
      if (existing.snapshotStorageId !== args.snapshotStorageId) {
        await ctx.storage.delete(args.snapshotStorageId);
      }
      return existing._id;
    }

    await ctx.db.patch("aiChatSessions", session._id, {
      model: args.model,
      turnCount: session.turnCount + 1,
      updatedAt: args.completedAt,
    });
    return await ctx.db.insert("aiChatTurns", {
      sessionId: session._id,
      captureKey: args.captureKey,
      turnKey: args.turnKey,
      snapshotStorageId: args.snapshotStorageId,
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      finishReason: args.finishReason,
      isAborted: args.isAborted,
    });
  },
});

// Bench replay evidence is public: anyone with the run URL can inspect the set.
// Writes stay authenticated; only this read path is open.
export const getReplay = query({
  args: { sessionKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      session: sessionValidator,
      turns: v.array(replayTurnValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("aiChatSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    if (!session) return null;

    const turns = await ctx.db
      .query("aiChatTurns")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .order("asc")
      .collect();
    return {
      session: {
        sessionKey: session.sessionKey,
        model: session.model,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        turnCount: session.turnCount,
      },
      turns: await Promise.all(turns.map(async (turn) => ({
        captureKey: turn.captureKey,
        turnKey: turn.turnKey,
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        finishReason: turn.finishReason,
        isAborted: turn.isAborted,
        snapshotUrl: await ctx.storage.getUrl(turn.snapshotStorageId),
      }))),
    };
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(sessionValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const sessions = await ctx.db
      .query("aiChatSessions")
      .withIndex("by_updated")
      .order("desc")
      .take(limit);
    return sessions.map((session) => ({
      sessionKey: session.sessionKey,
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turnCount: session.turnCount,
    }));
  },
});

export const listMine = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(sessionValidator),
  handler: async (ctx, args) => {
    const ownerId = await authenticatedUserId(ctx);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 30)));
    const sessions = await ctx.db
      .query("aiChatSessions")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(limit);
    return sessions.map((session) => ({
      sessionKey: session.sessionKey,
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turnCount: session.turnCount,
    }));
  },
});
