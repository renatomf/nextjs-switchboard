// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

Sentry.init({
  // Env first, literal as the fallback. The literal is what keeps the SDK
  // working if the variable is ever missing — a DSN is not a secret, it only
  // says which project to ingest into.
  dsn: process.env.SENTRY_DSN ?? "https://86ff20d901da2809a228a72a4bc3b5e8@o4510082957180928.ingest.us.sentry.io/4512051355385856",

  // 100% of traces in dev, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Puts local variable values on the stack frames of a server error, which is
  // usually the difference between reading a trace and re-deriving the state
  // that produced it.
  includeLocalVariables: true,

  // Structured logs. Off by default, and without it every Sentry.logger.* call
  // in the app is a silent no-op — so this has to stay set in all three runtime
  // configs, not just this one.
  enableLogs: true,

  integrations: [
    // Picks up console.warn/console.error the app already writes — including
    // Next's own — so a log doesn't have to be rewritten to be visible. Info and
    // debug are left out: they are noise at this level, and the calls worth
    // keeping are written as Sentry.logger.* directly.
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
})
