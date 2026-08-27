import { convexAuth } from "@convex-dev/auth/server";
import type { AuthProviderConfig } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous"
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials"
import { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

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

const providers: AuthProviderConfig[] = [Anonymous, Soundcloud];

// E2E helper: sign in as the service SoundCloud user without automating the
// OAuth UI. Enabled per deployment by setting E2E_SERVICE_LOGIN_SECRET — keep
// it unset on production. The caller proves itself with the secret; the
// session then attaches to the *existing* service-user account (same
// soundcloudUserId, same stored SoundCloud tokens). See cypress/README.md.
if (process.env.E2E_SERVICE_LOGIN_SECRET) {
  providers.push(
    ConvexCredentials({
      id: "soundcloud-service",
      authorize: async (credentials, ctx) => {
        if (credentials?.secret !== process.env.E2E_SERVICE_LOGIN_SECRET) return null;
        const soundcloudUserId = process.env.SOUNDCLOUD_USER_ID;
        if (!soundcloudUserId) return null;
        const userId = await ctx.runQuery(internal.users.serviceUserId, { soundcloudUserId });
        return userId ? { userId } : null;
      },
    }) as AuthProviderConfig,
  );
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers,
  callbacks: {
    async afterUserCreatedOrUpdated(ctx: MutationCtx, { userId, existingUserId, provider, type }) {
      const user = await ctx.db.get("users", userId)
      await ctx.db.patch("users", userId, {
        trialMessages: user?.trialMessages ?? 10,
        trialTokens: user?.trialTokens ?? 16000000,
        tokens: user?.tokens ?? 0,
      })
      if (existingUserId === null) {
        await ctx.scheduler.runAfter(0, internal.telemetry.recordBusinessEvent, {
          event: "auth.user_created",
          userId: String(userId),
          provider: provider.id,
          authType: type,
        })
      }
    }
  }
});
