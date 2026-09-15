import * as Sentry from "@sentry/nextjs"

import {
  countWebhookCall,
  getLatestWorkflowVersion,
  getWebhookForRequest,
  markWebhookUsed,
} from "@/features/workflows/data"
import {
  isOverRateLimit,
  rateLimitWindowStart,
  retryAfterSeconds,
} from "@/features/workflows/lib/webhook-rate-limit"
import { verifyWebhookSignature } from "@/features/workflows/lib/webhook-signature"
import { startWorkflowRun } from "@/features/workflows/start-run"
import { fetchOrgIsPro } from "@/lib/org-plan"

// Where the caller puts the signature of the request, and where it may put a
// key of its own for the event it is delivering.
const SIGNATURE_HEADER = "x-switchboard-signature"
const IDEMPOTENCY_HEADER = "idempotency-key"

// Tagged on every run a webhook starts, next to the workflow's own tag, so a
// run from outside can be told apart from one a person or a schedule started.
const WEBHOOK_RUN_TAG = "webhook"

// Starts a workflow from outside. There is no session here: what proves the
// caller may start this workflow is the signature, checked against the secret
// the workflow's webhook holds.
//
// The order of the checks is deliberate. The webhook is looked up first, the
// signature next, and only a signed request is counted against the rate limit:
// otherwise anyone could fill the counter and lock the real sender out for the
// rest of the window.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await params

  Sentry.getIsolationScope().setAttributes({
    route: "POST /api/webhooks/workflows/[id]",
    workflowId,
  })

  // The body exactly as it was sent: the signature covers these bytes, and
  // parsing and re-serializing it would change them.
  const body = await request.text()

  const webhook = await getWebhookForRequest(workflowId)

  // The same answer for a workflow with no webhook and a workflow that does
  // not exist, so a caller cannot learn which ids are real.
  if (!webhook) {
    Sentry.logger.warn("Webhook call refused — no webhook", { workflowId })

    return Response.json({ error: "Webhook not found" }, { status: 404 })
  }

  const { orgId } = webhook

  const signature = verifyWebhookSignature({
    header: request.headers.get(SIGNATURE_HEADER),
    body,
    secret: webhook.secret,
    now: new Date(),
  })

  if (!signature.ok) {
    Sentry.logger.warn("Webhook call refused — signature", {
      orgId,
      workflowId,
      reason: signature.problem,
    })

    return Response.json({ error: signature.problem }, { status: 401 })
  }

  const now = new Date()
  const windowStart = rateLimitWindowStart(now)
  const calls = await countWebhookCall(workflowId, windowStart)

  if (isOverRateLimit(calls)) {
    const retryAfter = retryAfterSeconds(now, windowStart)

    Sentry.logger.warn("Webhook call refused — rate limit", {
      orgId,
      workflowId,
      calls,
    })

    return Response.json(
      { error: "Too many calls for this workflow" },
      { status: 429, headers: { "retry-after": String(retryAfter) } }
    )
  }

  // The org's plan can have changed since the webhook was made, and a webhook
  // fires unattended just as a schedule does. Clerk not answering is not an
  // answer: nothing is started, and the sender is told to come back.
  let isPro: boolean

  try {
    isPro = await fetchOrgIsPro(orgId, {
      secretKey: process.env.CLERK_SECRET_KEY,
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { route: "webhook" },
      extra: { orgId, workflowId },
    })

    return Response.json(
      { error: "Cannot check the organization's plan right now" },
      { status: 503 }
    )
  }

  if (!isPro) {
    Sentry.logger.warn("Webhook call refused — plan", { orgId, workflowId })

    return Response.json(
      { error: "Webhook triggers are part of the Pro plan" },
      { status: 403 }
    )
  }

  // A workflow that has never been published has nothing to run: the canvas
  // becomes a version on a Run, or when a schedule or webhook is set up.
  const version = await getLatestWorkflowVersion(orgId, workflowId)

  if (!version) {
    Sentry.logger.warn("Webhook call refused — no version", {
      orgId,
      workflowId,
    })

    return Response.json(
      { error: "This workflow has no version to run" },
      { status: 409 }
    )
  }

  // The caller's own key for the event it is delivering, under this workflow
  // so two workflows cannot collide on the same event id. Without one, every
  // delivery of the same event starts its own run.
  const callerKey = request.headers.get(IDEMPOTENCY_HEADER)

  const started = await startWorkflowRun({
    orgId,
    workflowId,
    isPro,
    version: async () => version,
    tags: [WEBHOOK_RUN_TAG],
    ...(callerKey
      ? { idempotencyKey: `${WEBHOOK_RUN_TAG}:${workflowId}:${callerKey}` }
      : {}),
  })

  if (!started.alreadyGoing && started.recordError !== undefined) {
    // The run is going ahead, and the worker writes the row itself when it
    // starts. Reported, since the row is late until then.
    Sentry.captureException(started.recordError, {
      tags: { area: "executions", trigger: "webhook" },
      extra: { orgId, workflowId, runId: started.runId },
    })
  }

  await markWebhookUsed(workflowId)

  Sentry.logger.info("Webhook call started a run", {
    orgId,
    workflowId,
    runId: started.runId,
    alreadyGoing: started.alreadyGoing,
  })

  // 202: the run is accepted and goes on after this answer. The caller gets
  // the run's id, which is what it would need to ask about it later.
  return Response.json(
    {
      runId: started.runId,
      status: started.alreadyGoing ? "already-running" : "started",
    },
    { status: 202 }
  )
}
