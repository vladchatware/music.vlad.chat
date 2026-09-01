import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { api } from "@/convex/_generated/api";

import MeLibrary, { type DJRun } from "./MeLibrary";

export const metadata: Metadata = {
  title: "My records — music.vlad.chat",
  description: "Your SoundCloud playlists, likes, and recent listening history.",
};

export default async function MePage() {
  let user = null;
  let runs: DJRun[] = [];
  try {
    const token = await convexAuthNextjsToken();
    if (token) {
      user = await fetchQuery(api.users.viewer, {}, { token });
      try {
        runs = await fetchQuery(api.aiChatSessions.listMine, { limit: 50 }, { token });
      } catch (error) {
        console.error("Failed to load DJ runs", error);
      }
    }
  } catch {
    user = null;
  }
  const hasDevelopmentServiceUser =
    process.env.NODE_ENV === "development" && Boolean(process.env.SOUNDCLOUD_USER_ID);

  if ((!user || user.isAnonymous || !user.soundcloudAccessToken) && !hasDevelopmentServiceUser) {
    redirect("/dashboard?returnTo=/me");
  }

  return <MeLibrary runs={runs} />;
}
