import { convexAuth } from "@convex-dev/auth/server";
import type { AuthProviderConfig } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous"
import { MutationCtx } from "./_generated/server";

const Soundcloud: AuthProviderConfig = (options) => {
  return {
    id: 'soundcloud',
    name: 'SoundCloud',
    type: 'oauth',
    authorization: 'https://secure.soundcloud.com/authorize',
    token: 'https://secure.soundcloud.com/oauth/token',
    userinfo: {
      url: 'https://api.soundcloud.com/me',
      async request(context) {
        const me = await fetch(`https://api.soundcloud.com/me`, {
          headers: {
            Authorization: `Bearer ${context.tokens.access_token}`
          }
        })
        return me.json()
      }
    },
    profile(profile, tokens) {
      return {
        id: String(profile.id),
        name: profile.username || profile.full_name,
        email: profile.email,
        image: profile.avatar_url,
        soundcloudId: String(profile.id),
        soundcloudAccessToken: tokens.access_token,
        soundcloudRefreshToken: tokens.refresh_token,
      };
    },
    client: {
      token_endpoint_auth_method: 'client_secret_post'
    },
    options,
  };
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Anonymous,
    Soundcloud,
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx: MutationCtx, { userId }) {
      await ctx.db.patch(userId, {
        trialMessages: 10,
        trialTokens: 16000000,
        tokens: 0
      })

      const user = await ctx.db.get(userId)
      if (!user) return

      const ownerId = '23625673'
      if ((user as any).soundcloudId === ownerId && (user as any).soundcloudRefreshToken) {
        const existing = await ctx.db.query("settings").first()
        if (existing) {
          await ctx.db.patch(existing._id, { soundcloudRefreshToken: (user as any).soundcloudRefreshToken })
        } else {
          await ctx.db.insert("settings", { soundcloudRefreshToken: (user as any).soundcloudRefreshToken })
        }
      }
    }
  }
});
