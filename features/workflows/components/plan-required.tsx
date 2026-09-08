"use client"

import { useEffect, useRef } from "react"
import * as Sentry from "@sentry/nextjs"
import { Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useProPlan } from "@/features/workflows/hooks/use-pro-plan"
import { PlanRequiredError } from "@/lib/billing"

// The screen a non-pro org lands on when the workflow it opened holds a node
// its plan doesn't cover. Rendered in place of the canvas rather than thrown
// into the error boundary: Next.js replaces a server error's message with a
// digest in production, and the whole point here is that the user reads which
// node is the problem and can act on it.
export function PlanRequired({
  message,
  workflowId,
}: {
  message: string
  workflowId: string
}) {
  const { goToBilling } = useProPlan()
  const reported = useRef(false)

  useEffect(() => {
    // The server already filed this refusal with the org and the graph behind
    // it. This is the browser's side of the same event — it carries the user,
    // the route and the session replay, which the server has no handle on.
    //
    // Guarded because React runs effects twice in development's strict mode,
    // and one refusal should be one report.
    if (reported.current) return
    reported.current = true

    Sentry.logger.warn("Plan gate screen shown", { workflowId, message })
    Sentry.captureException(new PlanRequiredError(message), {
      tags: { gate: "premium-node", side: "client" },
      extra: { workflowId },
    })
  }, [message, workflowId])

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lock />
        </EmptyMedia>
        <EmptyTitle>{message}</EmptyTitle>
        <EmptyDescription>
          This workflow uses a node your organization&apos;s plan doesn&apos;t
          cover, so it can&apos;t be opened or run. Upgrade to Pro to get it
          back.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={goToBilling}>Upgrade to Pro</Button>
      </EmptyContent>
    </Empty>
  )
}
