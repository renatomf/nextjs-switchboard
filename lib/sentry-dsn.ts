// The DSN the browser SDK reports with. The literal fallback matters most in
// the browser: the variable is inlined at build time, so a missing one would
// silently disable the whole browser SDK. The tunnel route checks every
// envelope against this same value.
export const SENTRY_BROWSER_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  "https://86ff20d901da2809a228a72a4bc3b5e8@o4510082957180928.ingest.us.sentry.io/4512051355385856"
