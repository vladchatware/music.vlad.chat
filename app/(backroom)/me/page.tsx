import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { api } from "@/convex/_generated/api";

import MeLibrary from "./MeLibrary";

export const metadata: Metadata = {
  title: "My records — music.vlad.chat",
  description: "Your SoundCloud playlists, likes, and recent listening history.",
};

export default async function MePage() {
  let user = null;
  try {
    const token = await convexAuthNextjsToken();
    user = token ? await fetchQuery(api.users.viewer, {}, { token }) : null;
  } catch {
    user = null;
  }
  const hasDevelopmentServiceUser =
    process.env.NODE_ENV === "development" && Boolean(process.env.SOUNDCLOUD_USER_ID);

  if ((!user || user.isAnonymous || !user.soundcloudAccessToken) && !hasDevelopmentServiceUser) {
    redirect("/dashboard?returnTo=/me");
  }

  return <MeLibrary />;
}
