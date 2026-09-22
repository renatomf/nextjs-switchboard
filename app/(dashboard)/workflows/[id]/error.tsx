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

// The prop is "retry", not "unstable_retry": it stabilised under the new name
// in Next 16.3.0, and this project moved to 16.3.5. Nothing failed at build
// time, because this component declares the shape it expects rather than
// importing one from Next — so the code type-checked against a contract the
// framework had stopped honouring, and the button threw only when someone in
// trouble clicked it.
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  // Re-fetches and re-renders this boundary's children. Not reset(), which
  // only clears the error state without fetching again — and what put us here
  // was the server failing, so fetching again is the recovery.
  retry: () => void
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
        <Button onClick={() => retry()}>
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
