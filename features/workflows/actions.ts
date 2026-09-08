"use server"

import * as Sentry from "@sentry/nextjs"
import { auth } from "@clerk/nextjs/server"
import { LiveblocksError } from "@liveblocks/node"
import { tasks, runs } from "@trigger.dev/sdk"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import type { helloWorldTask } from "@/trigger/example"
import type { runWorkflowTask } from "@/features/workflows/tasks/run-workflow"

import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  saveWorkflowGraph
} from "@/features/workflows/data"
import {
  planRequiredMessage,
  premiumNodeLabels,
} from "@/features/workflows/lib/premium-gate"
import { PRO_PLAN, PlanRequiredError } from "@/lib/billing"
import { getLiveblocks } from "@/lib/liveblocks"
import { WorkflowGraph } from "@/lib/db/schema"

export async function createWorkflowAction(name: string) {
  const { orgId } = await auth()

  if (!orgId) {
    throw new Error("No active organization")
  }

  // Per-request, so every log this action emits carries the org without each
  // call repeating it. Isolation scope and not global: two orgs can be creating
  // a workflow at the same time on the same server.
  Sentry.getIsolationScope().setAttributes({
    action: "createWorkflowAction",
    orgId,
  })

  const workflow = await createWorkflow(orgId, name)

  Sentry.logger.info("Workflow created", {
    orgId,
    workflowId: workflow.id,
    name: workflow.name,
  })

  // The workflow list lives in the (dashboard) layout, which wraps both "/" and
  // "/workflows/[id]", so revalidate from the root to refresh it everywhere.
  revalidatePath("/", "layout")
  redirect(`/workflows/${workflow.id}`)
}

export async function deleteWorkflowAction(workflowId: string) {
  const { orgId } = await auth()

  if (!orgId) {
    throw new Error("No active organization")
  }

  Sentry.getIsolationScope().setAttributes({
    action: "deleteWorkflowAction",
    orgId,
    workflowId,
  })

  // Scope the lookup to the org so one organization can't delete another's
  // workflow by guessing its id.
  const workflow = await getWorkflow(orgId, workflowId)

  if (!workflow) {
    // Either a stale list or an id from another org — worth seeing which,
    // since only one of those is a bug on our side.
    Sentry.logger.warn("Workflow delete skipped — not found", {
      orgId,
      workflowId,
    })
    throw new Error("Workflow not found")
  }

  // The workflow id doubles as its Liveblocks room id - clean it up too. The
  // room goes first: if this throws, the row survives, so the workflow is still
  // reachable and the user can retry. Dropping the row first would strand the
  // room under an id nothing references any more.
  try {
    await getLiveblocks().deleteRoom(workflowId)
  } catch (error) {
    // A room only exists once someone has opened the workflow, so a 404 means
    // there was never one to delete. Anything else is a real failure.
    if (!(error instanceof LiveblocksError) || error.status !== 404) {
      throw error
    }
  }

  await deleteWorkflow(orgId, workflowId)

  Sentry.logger.info("Workflow deleted", {
    orgId,
    workflowId,
    name: workflow.name,
  })

  // No redirect here: a redirecting server action rejects its client-side
  // promise, which would make the caller's catch fire on success. The caller
  // navigates instead.
  revalidatePath("/", "layout")
}

export async function runWorkflowAction({
  id,
  graph
}: {
  id: string
  graph: WorkflowGraph
}) {
  const { orgId, has } = await auth()

  if (!orgId) {
    throw new Error("No active organization")
  }

  Sentry.getIsolationScope().setAttributes({
    action: "runWorkflowAction",
    orgId,
    workflowId: id,
  })

  // Premium nodes are gated at run time, not just in the toolbar. A graph can
  // hold one without anyone having clicked a locked button: the org may have
  // downgraded since, or a pro member on the same Liveblocks canvas may have
  // added it. This is the last point that can stop it — the Trigger.dev task
  // runs without a Clerk session, so it has no has() to ask.
  //
  // Checked before the save so a rejected run doesn't persist the graph that
  // caused it.
  if (!has({ plan: PRO_PLAN })) {
    // The graph in hand, not the saved one: the canvas is shared, so what is
    // about to run can hold a node that was never persisted.
    const premium = premiumNodeLabels(graph)

    if (premium.length > 0) {
      const error = new PlanRequiredError(
        `${planRequiredMessage(premium)}. Upgrade to run this workflow.`
      )

      // Reaching this means the page gate was bypassed — a node added live on
      // the canvas, or a request that never went through the UI — so it is
      // worth a report rather than a silent rejection.
      Sentry.logger.warn("Workflow run blocked by plan", {
        orgId,
        workflowId: id,
        premiumNodes: premium.join(", "),
        requiredPlan: PRO_PLAN,
      })

      Sentry.captureException(error, {
        tags: { gate: "premium-node", side: "server" },
        extra: { orgId, workflowId: id, premiumNodes: premium },
      })

      throw error
    }
  }

  // saveWorkflowGraph re-runs validateGraph as the save-time backstop, so this
  // is also where a graph the client let through gets rejected.
  try {
    await saveWorkflowGraph({ orgId, id, graph })
  } catch (error) {
    Sentry.logger.warn("Workflow run blocked — graph validation failed", {
      orgId,
      workflowId: id,
      reason: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  const handle = await tasks.trigger<typeof runWorkflowTask>(
    "run-workflow",
    { workflowId: id, orgId },
    { tags: [`workflow:${id}`] },
  )

  // One wide event rather than a start/end pair: everything worth correlating
  // about this run is knowable here, and the run's own progress is already
  // traced in Trigger.dev under this same id.
  Sentry.logger.info("Workflow run started", {
    orgId,
    workflowId: id,
    runId: handle.id,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  })

  return handle
}

export async function cancelWorkflowRunAction(runId: string) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")

  Sentry.getIsolationScope().setAttributes({
    action: "cancelWorkflowRunAction",
    orgId,
    runId,
  })

  await runs.cancel(runId)

  Sentry.logger.info("Workflow run cancelled", { orgId, runId })
}
