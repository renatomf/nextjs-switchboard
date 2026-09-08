import * as Sentry from "@sentry/nextjs"

Sentry.init({
  // The literal fallback matters most here: this variable is inlined at build
  // time, so a missing one silently disables the whole browser SDK.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "https://86ff20d901da2809a228a72a4bc3b5e8@o4510082957180928.ingest.us.sentry.io/4512051355385856",

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
