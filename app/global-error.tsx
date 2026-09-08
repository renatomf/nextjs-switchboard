"use client"

import * as Sentry from "@sentry/nextjs"
import NextError from "next/error"
import { useEffect } from "react"

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    // The outermost boundary: reaching it means the root layout is gone and the
    // user is looking at a blank Next error page, so this is fatal rather than
    // error.
    Sentry.logger.fatal("App hit the global error boundary", {
      message: error.message,
      digest: error.digest ?? "none",
    })
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  )
}
