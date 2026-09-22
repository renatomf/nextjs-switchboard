// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

import { redactEvent } from "@/lib/redact-event"

Sentry.init({
  // Everything on its way to Sentry is cleaned first. Sentry is the one sink
  // outside this infrastructure, and the server config asks for local
  // variables on stack frames — which in this code base means a plaintext
  // webhook secret and the vault master key can ride along.
  beforeSend: (event) => redactEvent(event),
  // Logs and transactions are separate ways out: a Sentry.logger.* call
  // carries whatever it was handed, and a transaction carries the URL.
  beforeSendLog: (log) => redactEvent(log),
  beforeSendTransaction: (event) => redactEvent(event),

  dsn:
    process.env.SENTRY_DSN ??
    "https://86ff20d901da2809a228a72a4bc3b5e8@o4510082957180928.ingest.us.sentry.io/4512051355385856",

  // 100% of traces in dev, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Matches the server and client configs. The proxy runs here, so without it
  // anything logged from middleware is dropped.
  enableLogs: true,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
})
