import * as Sentry from "@sentry/nextjs"

import { SENTRY_BROWSER_DSN } from "@/lib/sentry-dsn"

Sentry.init({
  dsn: SENTRY_BROWSER_DSN,

  // Through the app's own route, which forwards only the envelope to Sentry:
  // see app/monitoring/route.ts.
  tunnel: "/monitoring",

  // 100% of transactions in dev, 10% in production
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay: 10% of all sessions, 100% of sessions with an error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  integrations: [
    Sentry.replayIntegration(),
    // Browser console.warn/console.error, forwarded as structured logs.
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
})

// Instruments App Router navigations as spans
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
