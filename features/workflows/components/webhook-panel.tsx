"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import * as Sentry from "@sentry/nextjs"
import { Copy, KeyRound, Lock } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  createWorkflowWebhookAction,
  deleteWorkflowWebhookAction,
} from "@/features/workflows/actions"
import { useProPlan } from "@/features/workflows/hooks/use-pro-plan"
import type { WorkflowWebhook } from "@/lib/db/schema"

// What the page knows of a workflow's webhook. The secret is not part of it:
// it goes to the browser once, when it is made, and never again.
export type WebhookSummary = Pick<WorkflowWebhook, "lastUsedAt">

// The Webhook section of the Triggers tab: the address to call, the secret to
// sign with, and when it was last used.
export function WebhookPanel({
  workflowId,
  webhook,
}: {
  workflowId: string
  webhook: WebhookSummary | null
}) {
  const router = useRouter()
  const { isLoaded, isPro, goToBilling } = useProPlan()
  const [isPending, startTransition] = useTransition()
  // Held only until the tab is left: the server will not hand it over again.
  const [secret, setSecret] = useState<string | null>(null)

  // The address the sender posts to, on whatever host this page is open on,
  // so it is right in development and in production without a setting of its
  // own. Read in the initializer: this panel only mounts in the browser.
  const [url] = useState(
    () => `${window.location.origin}/api/webhooks/workflows/${workflowId}`
  )

  const copy = (value: string, what: string) => {
    navigator.clipboard.writeText(value).then(
      () => toast.success(`${what} copied`),
      () => toast.error(`Could not copy the ${what.toLowerCase()}`)
    )
  }

  const handleCreate = () => {
    startTransition(async () => {
      try {
        const result = await createWorkflowWebhookAction(workflowId)

        if (!result.ok) {
          toast.error(result.error)
          return
        }

        setSecret(result.secret)
        toast.success(webhook ? "New secret ready" : "Webhook ready")
        router.refresh()
      } catch (error) {
        Sentry.captureException(error, {
          tags: { action: "create-workflow-webhook" },
          extra: { workflowId },
        })
        toast.error("Failed to set up the webhook")
      }
    })
  }

  const handleRemove = () => {
    startTransition(async () => {
      try {
        await deleteWorkflowWebhookAction(workflowId)
        setSecret(null)
        toast.success("Webhook removed")
        router.refresh()
      } catch (error) {
        Sentry.captureException(error, {
          tags: { action: "delete-workflow-webhook" },
          extra: { workflowId },
        })
        toast.error("Failed to remove the webhook")
      }
    })
  }

  if (!isLoaded) {
    return (
      <div className="p-3">
        <Spinner />
      </div>
    )
  }

  // Off Pro the form is locked, but a webhook made while on Pro can still be
  // removed: closing a way in must never depend on the plan.
  if (!isPro) {
    return (
      <div className="flex flex-col items-start gap-3 p-3 text-xs">
        <p className="text-muted-foreground">
          Webhook triggers are part of the Pro plan.
        </p>
        <Button size="sm" onClick={goToBilling}>
          <Lock />
          Upgrade to use webhooks
        </Button>
        {webhook && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={handleRemove}
          >
            Remove webhook
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {webhook ? (
        <p className="text-xs text-muted-foreground">
          {webhook.lastUsedAt
            ? `Last call ${webhook.lastUsedAt.toLocaleString()}`
            : "Never called yet."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          No webhook. Create one to start this workflow from another system.
        </p>
      )}

      {webhook && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-url" className="text-xs">
            POST to
          </Label>
          <div className="flex gap-1.5">
            <Input id="webhook-url" readOnly value={url} />
            <Button
              size="icon"
              variant="secondary"
              title="Copy the address"
              onClick={() => copy(url, "Address")}
            >
              <Copy />
            </Button>
          </div>
        </div>
      )}

      {secret && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-secret" className="text-xs">
            Signing secret
          </Label>
          <div className="flex gap-1.5">
            <Input id="webhook-secret" readOnly value={secret} />
            <Button
              size="icon"
              variant="secondary"
              title="Copy the secret"
              onClick={() => copy(secret, "Secret")}
            >
              <Copy />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Copy it now: it is not shown again. Sign each request with it and
            send the signature as the x-switchboard-signature header.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isPending} onClick={handleCreate}>
          {isPending ? <Spinner /> : <KeyRound />}
          {webhook ? "New secret" : "Create webhook"}
        </Button>
        {webhook && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={handleRemove}
          >
            Remove webhook
          </Button>
        )}
      </div>

      {webhook && (
        <p className="text-xs text-muted-foreground">
          A call starts the workflow as it was last saved or run. Send an
          Idempotency-Key header so the same event never starts two runs.
        </p>
      )}
    </div>
  )
}
