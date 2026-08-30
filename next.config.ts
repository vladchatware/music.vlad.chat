import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @vercel/queue's OIDC client reads CLI credentials via this Node-only
  // package. Keep it out of Next's server bundle so os/path detection works.
  serverExternalPackages: ["@vercel/cli-config"],
  async rewrites() {
    return [{
      source: '/',
      destination: '/index.html'
    }]
  },
  // Allow sibling apps (media.vlad.chat studio/renderer) to read track APIs
  // and pages directly from the browser.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
      ],
    }]
  },
  experimental: {
    turbopackScopeHoisting: false
  }
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
