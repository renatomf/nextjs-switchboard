import { notFound } from "next/navigation"
import * as Sentry from "@sentry/nextjs"
import { auth } from "@clerk/nextjs/server"
import { ReactFlowProvider } from "@xyflow/react"

import { PRO_PLAN, PlanRequiredError } from "@/lib/billing"
import { getLiveblocks } from "@/lib/liveblocks"
import { getWorkflow, getWorkflowSchedule } from "@/features/workflows/data"
import {
  planRequiredMessage,
  premiumNodeLabelsOnCanvas,
} from "@/features/workflows/lib/premium-gate"
import { createRunsReadToken } from "@/features/workflows/lib/runs-token"
import { triggerEnvironmentOf } from "@/features/workflows/lib/trigger-environment"
import { PlanRequired } from "@/features/workflows/components/plan-required"
import { Room } from "@/features/workflows/components/room"
import { WorkflowRunsProvider } from "@/features/workflows/components/workflow-runs-provider"
import { WorkflowShell } from "@/features/workflows/components/workflow-shell"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // protect() answers the signed-out case with a redirect to sign-in; the
  // notFound() below is now only about a signed-in user with no active org.
  const { orgId, has } = await auth.protect()
  if (!orgId) notFound()

  // Isolation scope, not global: it is per-request, so one org's attributes
  // can't bleed into another's log on a concurrent render.
  Sentry.getIsolationScope().setAttributes({ orgId, workflowId: id })

  // Scoped to the active org, so this is undefined for a workflow belonging to
  // another one. Not a 404 yet — the plan gate below answers first.
  const workflow = await getWorkflow(orgId, id)

  // The plan gate runs ahead of the 404, and against the canvas rather than the
  // active org's copy of it. A workflow URL gets shared and pasted: whether the
  // org that follows it built the workflow, inherited it and then downgraded,
  // or never had access at all, the honest answer for a canvas holding an Agent
  // node is that the node needs Pro. Answering "not found" would send someone
  // to look for a workflow they can see exists.
  //
  // Only asked when it can change the outcome, so a pro org never pays for the
  // extra room read, and it runs before any room or token is minted for a
  // canvas that is not going to render.
  if (!has({ plan: PRO_PLAN })) {
    const premium = await premiumNodeLabelsOnCanvas(id, workflow?.graph ?? null)

    if (premium.length > 0) {
      const message = planRequiredMessage(premium)

      // The log is the one that answers "how often does this happen, and to
      // whom" — it carries the org and whether the link was theirs. The issue
      // below is the one that answers "what broke".
      Sentry.logger.warn("Workflow blocked by plan", {
        orgId,
        workflowId: id,
        premiumNodes: premium.join(", "),
        requiredPlan: PRO_PLAN,
        ownsWorkflow: Boolean(workflow),
      })

      // Reported, not just rendered: this is a paying feature being reached for
      // from a plan that doesn't carry it, which is worth seeing in Sentry.
      Sentry.captureException(new PlanRequiredError(message), {
        tags: { gate: "premium-node", side: "server" },
        extra: {
          orgId,
          workflowId: id,
          premiumNodes: premium,
          // Whether the refusal was the org's own workflow or a link it
          // followed — the same screen, but very different stories.
          ownsWorkflow: Boolean(workflow),
        },
      })

      return <PlanRequired message={message} workflowId={id} />
    }
  }

  // Nothing premium in the way, so ordinary org scoping decides: another org's
  // workflow is not visible here.
  if (!workflow) notFound()

  // Rooms are private by default under ID-token auth. Grant write access to tht owning org, matching the `groupIds: [orgId]` issued by the auth endpoint.
  await getLiveblocks().getOrCreateRoom(id, {
    organizationId: orgId,
    defaultAccesses: [],
    groupsAccesses: {
      [orgId]: ["room:write"],
    },
    metadata: {
      title: workflow.name,
    },
  })

  // The run token, and what the Schedule tab shows: the workflow's schedule in
  // this environment, like the schedule itself.
  const [publicAccessToken, saved] = await Promise.all([
    createRunsReadToken(id),
    getWorkflowSchedule(
      orgId,
      id,
      triggerEnvironmentOf(process.env.TRIGGER_SECRET_KEY)
    ),
  ])

  const schedule = saved
    ? { preset: saved.preset, timezone: saved.timezone, active: saved.active }
    : null

  // The palette lives in the sidebar, outside <ReactFlow>, so the provider has
  // to sit above both of them for the two to share a single React Flow store.
  return (
    <Room roomId={id}>
      <ReactFlowProvider>
        <WorkflowRunsProvider
          workflowId={id}
          publicAccessToken={publicAccessToken}
        >
          <WorkflowShell workflowId={id} schedule={schedule} />
        </WorkflowRunsProvider>
      </ReactFlowProvider>
    </Room>
  )
}
