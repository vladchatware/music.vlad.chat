import {
  convexAuthNextjsMiddleware,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "./convex/_generated/api";

function isBackroom(pathname: string): boolean {
  return pathname === "/backroom" || /^\/tracks\/[^/]+\/backroom(?:\/|$)/.test(pathname);
}

function backroomSignIn(request: Parameters<typeof nextjsMiddlewareRedirect>[0]) {
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  return nextjsMiddlewareRedirect(
    request,
    `/dashboard?returnTo=${encodeURIComponent(returnTo)}`,
  );
}

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (!isBackroom(request.nextUrl.pathname)) return;
  if (process.env.NODE_ENV !== "production") return;
  const token = await convexAuth.getToken();
  if (!token) return backroomSignIn(request);
  const user = await fetchQuery(api.users.viewer, {}, { token });
  if (!user || user.isAnonymous || !user.soundcloudAccessToken) {
    return backroomSignIn(request);
  }
});

export const config = {
  // The following matcher runs middleware on all routes
  // except Sentry's tunnel and static assets.
  matcher: ["/((?!monitoring(?:/|$)|.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
