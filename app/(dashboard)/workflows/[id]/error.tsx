"use client" // Error boundaries must be Client Components

import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"
import { RotateCw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    // Anything that reaches this boundary is unhandled by definition, so it
    // goes to Sentry. A server error arrives here already digested — the
    // matching server-side event is what carries its stack, and the digest is
    // the string that ties the two together, which is why it is logged.
    Sentry.logger.error("Workflow route hit its error boundary", {
      message: error.message,
      digest: error.digest ?? "none",
    })
    Sentry.captureException(error)
  }, [error])

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>
          This workflow could not be loaded. Try again, or pick another workflow
          from the sidebar.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => unstable_retry()}>
          <RotateCw />
          Try again
        </Button>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">
            {error.digest}
          </p>
        ) : null}
      </EmptyContent>
    </Empty>
  )
}
