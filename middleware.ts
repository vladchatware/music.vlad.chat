import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";
import { NextResponse } from "next/server";

const ENCODED_DASHBOARD_QUERY = /^\/dashboard%3f/i;

export function decodeDashboardUrl(pathname: string): string | null {
  if (!ENCODED_DASHBOARD_QUERY.test(pathname)) return null;

  try {
    return decodeURIComponent(pathname.replace(ENCODED_DASHBOARD_QUERY, ""));
  } catch {
    return null;
  }
}

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const dashboardQuery = decodeDashboardUrl(request.nextUrl.pathname);
  if (dashboardQuery !== null) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/dashboard";
    destination.search = dashboardQuery;
    return NextResponse.redirect(destination);
  }
});

export const config = {
  // The following matcher runs middleware on all routes
  // except Sentry's tunnel and static assets.
  matcher: ["/((?!monitoring(?:/|$)|.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
