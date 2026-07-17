import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  enableLogs: true,
  enableMetrics: true,
  integrations: [
    Sentry.vercelAIIntegration({
      force: true,
      recordInputs: true,
      recordOutputs: true,
    }),
  ],
});
