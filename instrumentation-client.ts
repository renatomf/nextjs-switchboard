import * as Sentry from "@sentry/nextjs"

import { redactEvent } from "@/lib/redact-event"
import { SENTRY_BROWSER_DSN } from "@/lib/sentry-dsn"

Sentry.init({
  dsn: SENTRY_BROWSER_DSN,

  // Everything on its way to Sentry is cleaned first. Sentry is the one sink
  // outside this infrastructure, and the server config asks for local
  // variables on stack frames — which in this code base means a plaintext
  // webhook secret and the vault master key can ride along.
  beforeSend: (event) => redactEvent(event),
  // Logs and transactions are separate ways out: a Sentry.logger.* call
  // carries whatever it was handed, and a transaction carries the URL.
  beforeSendLog: (log) => redactEvent(log),
  beforeSendTransaction: (event) => redactEvent(event),

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
