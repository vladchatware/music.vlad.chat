import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";

import { api } from "../../convex/_generated/api";
import SignInGateway from "./SignInGateway";

function safeReturnTo(value: string | undefined, id: string | undefined): string {
  if (value?.startsWith("/") && !value.startsWith("//")) {
    const target = new URL(value, "http://internal");
    if (
      target.pathname === "/backroom" ||
      target.pathname === "/bench" ||
      /^\/bench\/[A-Za-z0-9._-]+$/.test(target.pathname) ||
      /^\/tracks\/\d+\/backroom$/.test(target.pathname)
    ) {
      return `${target.pathname}${target.search}`;
    }
  }
  if (id && /^\d+$/.test(id)) return `/tracks/${id}/backroom`;
  return "/backroom";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; returnTo?: string }>;
}) {
  const { id, returnTo: requestedReturnTo } = await searchParams;
  const returnTo = safeReturnTo(requestedReturnTo, id);
  const token = await convexAuthNextjsToken();
  const user = token ? await fetchQuery(api.users.viewer, {}, { token }) : null;

  if (user && !user.isAnonymous && user.soundcloudAccessToken) redirect(returnTo);
  return <SignInGateway returnTo={returnTo} />;
}
