import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous"
import { MutationCtx } from "./_generated/server";

const Soundcloud = (options) => {
  return {
    id: 'soundcloud',
    name: 'SoundCloud',
    type: 'oauth',
    authorization: "https://secure.soundcloud.com/authorize",
    token: "https://secure.soundcloud.com/oauth/token",
    userinfo: "https://api.soundcloud.com/me",
    profile(profile) {
      console.log(profile)
      return {
        id: profile.id,
        name: profile.username || profile.full_name,
        email: profile.email,
        image: profile.avatar_url
      }
    },
    options
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx: MutationCtx, { userId }) {
      await ctx.db.patch(userId, { trialMessages: 10, trialTokens: 16000000, tokens: 0 })
    }
  }
});
