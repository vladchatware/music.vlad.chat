import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";

const SESSION_KEY_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const INSTAGRAM_ACCOUNT_PATTERN = /^\d{4,40}$/;

function normalizedUsername(value: string): string {
  return value.trim().replace(/^@/, "").slice(0, 64);
}

export const prepareSession = mutation({
  args: {
    sessionKey: v.string(),
    instagramAccountId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerId = await getAuthUserId(ctx);
    if (!ownerId) throw new Error("Authentication required");
    if (!SESSION_KEY_PATTERN.test(args.sessionKey)) throw new Error("Invalid session key");
    if (!INSTAGRAM_ACCOUNT_PATTERN.test(args.instagramAccountId)) {
      throw new Error("Invalid Instagram account ID");
    }

    const existingKey = await ctx.db
      .query("liveSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    if (existingKey && existingKey.ownerId !== ownerId) {
      throw new Error("Session key already exists");
    }

    const now = Date.now();
    if (existingKey) {
      await ctx.db.patch(existingKey._id, {
        instagramAccountId: args.instagramAccountId,
        platformStatus: existingKey.platformStatus === "ended"
          ? "waiting"
          : existingKey.platformStatus,
        updatedAt: now,
      });
      return { sessionId: existingKey._id, sessionKey: existingKey.sessionKey };
    }

    const sessionId = await ctx.db.insert("liveSessions", {
      sessionKey: args.sessionKey,
      ownerId,
      instagramAccountId: args.instagramAccountId,
      platformStatus: "waiting",
      createdAt: now,
      updatedAt: now,
    });
    return { sessionId, sessionKey: args.sessionKey };
  },
});

export const listParticipants = query({
  args: { sessionKey: v.string() },
  handler: async (ctx, args) => {
    if (!SESSION_KEY_PATTERN.test(args.sessionKey)) return [];
    const session = await ctx.db
      .query("liveSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    if (!session || session.platformStatus === "ended") return [];
    return ctx.db
      .query("liveParticipants")
      .withIndex("by_session_activity", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .take(40);
  },
});

export const getSessionStatus = query({
  args: { sessionKey: v.string() },
  handler: async (ctx, args) => {
    if (!SESSION_KEY_PATTERN.test(args.sessionKey)) return null;
    const session = await ctx.db
      .query("liveSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    if (!session) return null;
    return {
      platformStatus: session.platformStatus,
      instagramAccountId: session.instagramAccountId,
    };
  },
});

export const simulateComment = mutation({
  args: { sessionKey: v.string(), username: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await getAuthUserId(ctx);
    if (!ownerId) throw new Error("Authentication required");
    let session = await ctx.db
      .query("liveSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    if (session && session.ownerId !== ownerId) {
      throw new Error("Live session not found");
    }
    if (!session) {
      const now = Date.now();
      const sessionId = await ctx.db.insert("liveSessions", {
        sessionKey: args.sessionKey,
        ownerId,
        platformStatus: "waiting",
        createdAt: now,
        updatedAt: now,
      });
      session = await ctx.db.get(sessionId);
    } else if (session.platformStatus === "ended") {
      const updatedAt = Date.now();
      await ctx.db.patch(session._id, { platformStatus: "waiting", updatedAt });
      session = {
        ...session,
        platformStatus: "waiting" as const,
        updatedAt,
      };
    }
    if (!session) throw new Error("Unable to create preview session");
    const username = normalizedUsername(args.username);
    if (!username) throw new Error("Username required");
    const now = Date.now();
    const existing = await ctx.db
      .query("liveParticipants")
      .withIndex("by_session_username", (q) =>
        q.eq("sessionId", session._id).eq("username", username),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastComment: args.text.slice(0, 500),
        commentCount: existing.commentCount + 1,
        lastCommentAt: now,
      });
      return existing._id;
    }
    return ctx.db.insert("liveParticipants", {
      sessionId: session._id,
      username,
      lastComment: args.text.slice(0, 500),
      commentCount: 1,
      joinedAt: now,
      lastCommentAt: now,
    });
  },
});

export const ingestComments = internalMutation({
  args: {
    instagramAccountId: v.string(),
    comments: v.array(v.object({
      commentId: v.string(),
      instagramUserId: v.optional(v.string()),
      username: v.string(),
      text: v.string(),
      timestamp: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("liveSessions")
      .withIndex("by_instagram_account_updated", (q) =>
        q.eq("instagramAccountId", args.instagramAccountId),
      )
      .order("desc")
      .first();
    if (!session || session.platformStatus === "ended") return { accepted: 0 };

    if (session.platformStatus !== "live") {
      await ctx.db.patch(session._id, { platformStatus: "live", updatedAt: Date.now() });
    }

    let accepted = 0;
    for (const comment of args.comments.slice(0, 100)) {
      const username = normalizedUsername(comment.username);
      if (!username) continue;
      const duplicate = await ctx.db
        .query("liveCommentEvents")
        .withIndex("by_comment_id", (q) => q.eq("commentId", comment.commentId))
        .unique();
      if (duplicate) continue;
      const now = comment.timestamp ?? Date.now();
      await ctx.db.insert("liveCommentEvents", {
        sessionId: session._id,
        commentId: comment.commentId,
        receivedAt: Date.now(),
      });
      const byId = comment.instagramUserId
        ? await ctx.db
          .query("liveParticipants")
          .withIndex("by_session_user", (q) =>
            q.eq("sessionId", session._id).eq("instagramUserId", comment.instagramUserId),
          )
          .unique()
        : null;
      const existing = byId ?? await ctx.db
        .query("liveParticipants")
        .withIndex("by_session_username", (q) =>
          q.eq("sessionId", session._id).eq("username", username),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          instagramUserId: comment.instagramUserId ?? existing.instagramUserId,
          username,
          lastComment: comment.text.slice(0, 500),
          commentCount: existing.commentCount + 1,
          lastCommentAt: now,
        });
      } else {
        await ctx.db.insert("liveParticipants", {
          sessionId: session._id,
          instagramUserId: comment.instagramUserId,
          username,
          lastComment: comment.text.slice(0, 500),
          commentCount: 1,
          joinedAt: now,
          lastCommentAt: now,
        });
      }
      accepted += 1;
    }
    return { accepted };
  },
});
