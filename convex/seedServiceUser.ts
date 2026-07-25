import { v } from "convex/values";
import { mutation } from "./_generated/server";

/**
 * One-shot: seeds or refreshes SoundCloud service user credentials in the
 * database so the dev environment can use them without OAuth.
 *
 * Usage from CLI:
 *   npx convex run convex/seedServiceUser:patchServiceUser \
 *     '{"soundcloudUserId":"23625673","accessToken":"...","refreshToken":"..."}'
 *
 * Or via the shell wrapper:  ./scripts/refresh-service-user.sh
 */
export const patchServiceUser = mutation({
  args: {
    soundcloudUserId: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "soundcloud").eq("providerAccountId", args.soundcloudUserId),
      )
      .collect();

    if (accounts.length === 0) {
      throw new Error(
        `No SoundCloud auth account found for user ${args.soundcloudUserId}. ` +
        "Sign in via SoundCloud on production first, or seed a user + auth account manually.",
      );
    }

    // Deduplicate — keep the first, remove extras
    const [primary, ...duplicates] = accounts;
    for (const dup of duplicates) {
      await ctx.db.delete(dup._id);
    }

    await ctx.db.patch(primary.userId, {
      soundcloudAccessToken: args.accessToken,
      ...(args.refreshToken ? { soundcloudRefreshToken: args.refreshToken } : {}),
    });

    return {
      userId: primary.userId,
      cleaned: duplicates.length,
    };
  },
});
