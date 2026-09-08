import * as Sentry from "@sentry/nextjs"
import { auth } from "@clerk/nextjs/server"

export const dynamic = "force-dynamic"

class SentryExampleAPIError extends Error {
  constructor(message: string | undefined) {
    super(message)
    this.name = "SentryExampleAPIError"
  }
}

// A faulty API route to test Sentry's error monitoring.
//
// It throws on every call by design, so it stays behind auth: left open it is
// an anonymous way to burn the project's Sentry quota. The proxy used to cover
// it implicitly by protecting everything unmatched; now it says so itself.
export async function GET() {
  await auth.protect()

  Sentry.logger.info("Sentry example API called")
  throw new SentryExampleAPIError(
    "This error is raised on the backend called by the example page."
  )
}
