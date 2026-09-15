"use server"

import * as Sentry from "@sentry/nextjs"
import { auth } from "@clerk/nextjs/server"
import { LiveblocksError } from "@liveblocks/node"
import { runs } from "@trigger.dev/sdk"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  advanceExecution,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  publishWorkflowVersion,
} from "@/features/workflows/data"
import {
  planRequiredMessage,
  premiumNodeLabels,
} from "@/features/workflows/lib/premium-gate"
import { isLiveRunStatus } from "@/features/workflows/lib/run-liveness"
import { isRunOfWorkflow } from "@/features/workflows/lib/run-ownership"
import { createRunsReadToken } from "@/features/workflows/lib/runs-token"
import { startWorkflowRun } from "@/features/workflows/start-run"
import { PRO_PLAN, PlanRequiredError } from "@/lib/billing"
import { getLiveblocks } from "@/lib/liveblocks"
import { WorkflowGraph } from "@/lib/db/schema"

// The most runs one liveness check looks up. The canvas shows at most one run
// going, so this only bounds a caller that is not the canvas: each id costs a
// request to Trigger.dev.
const MAX_LIVENESS_LOOKUPS = 5

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
  graph,
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
  // Checked before publishing so a rejected run doesn't persist the graph that
  // caused it.
  const isPro = has({ plan: PRO_PLAN })

  if (!isPro) {
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

  // Scoped to the org before the lock below is taken. The lock is keyed by the
  // workflow's id alone, so another org's id must not get to hold it, and a
  // clean "not found" tells a probe nothing about that workflow's runs.
  const workflow = await getWorkflow(orgId, id)

  if (!workflow) {
    Sentry.logger.warn("Workflow run refused — not found", {
      orgId,
      workflowId: id,
    })
    throw new Error("Workflow not found")
  }

  // A second Run while one is going hands back that run instead of starting
  // another (see startWorkflowRun).
  const started = await startWorkflowRun({
    orgId,
    workflowId: id,
    isPro,
    // The graph in hand becomes an immutable version, and the run gets that
    // version rather than the workflow: the task reads exactly this graph, even
    // if someone else hits Run before the worker gets to it. Publishing re-runs
    // validateGraph as the backstop, so this is also where a graph the client
    // let through gets rejected.
    version: () =>
      publishWorkflowVersion({ orgId, workflowId: id, graph }).catch(
        (error: unknown) => {
          Sentry.logger.warn("Workflow run blocked — version not published", {
            orgId,
            workflowId: id,
            reason: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
      ),
  })

  if (started.alreadyGoing) {
    Sentry.logger.info("Workflow run already going", {
      orgId,
      workflowId: id,
      runId: started.runId,
    })
    return { id: started.runId }
  }

  // Not worth failing the Run button over: the run is already in Trigger.dev,
  // and the worker writes the row itself when the run starts. Reported, since
  // the row is then late.
  if (started.recordError !== undefined) {
    Sentry.captureException(started.recordError, {
      tags: { area: "executions" },
      extra: { orgId, workflowId: id, runId: started.runId },
    })
  }

  // One wide event rather than a start/end pair: everything worth correlating
  // about this run is knowable here, and the run's own progress is already
  // traced in Trigger.dev under this same id.
  Sentry.logger.info("Workflow run started", {
    orgId,
    workflowId: id,
    versionId: started.versionId,
    runId: started.runId,
    queue: started.queue,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  })

  return { id: started.runId }
}

export async function cancelWorkflowRunAction({
  workflowId,
  runId,
}: {
  workflowId: string
  runId: string
}) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")

  Sentry.getIsolationScope().setAttributes({
    action: "cancelWorkflowRunAction",
    orgId,
    workflowId,
    runId,
  })

  // Every org's runs live in one Trigger.dev project, so a run id proves
  // nothing on its own: anyone signed in who learned one could stop another
  // org's run. Ownership is checked in two hops instead. The workflow has to
  // belong to this org, which the data layer scopes by orgId, and the run has
  // to belong to that workflow, which the tag stamped at trigger time says.
  const workflow = await getWorkflow(orgId, workflowId)
  const run = workflow ? await runs.retrieve(runId) : undefined

  if (!run || !isRunOfWorkflow(run, workflowId)) {
    // One answer for "not yours" and "not there", so a probe learns nothing
    // about runs it cannot see. Logged because reaching this from the UI is
    // not possible: the Stop button only offers the canvas's own live run.
    Sentry.logger.warn("Workflow run cancel refused — not this org's run", {
      orgId,
      workflowId,
      runId,
    })
    throw new Error("Run not found")
  }

  await runs.cancel(runId)

  // Recorded here as well as by the worker: its onCancel hook only fires for a
  // run it is executing, so a run stopped in the queue would otherwise stay
  // "queued" for good. Whichever write lands second changes nothing.
  await advanceExecution({
    runId,
    orgId,
    workflowId,
    event: "cancelled",
  }).catch((error: unknown) => {
    Sentry.captureException(error, {
      tags: { area: "executions" },
      extra: { orgId, workflowId, runId },
    })
  })

  Sentry.logger.info("Workflow run cancelled", { orgId, workflowId, runId })
}

// Which of these runs are still going, as Trigger.dev sees them now. The canvas
// asks while it shows a run as going: its realtime subscription can go silent
// without an error, and this is how it finds out a run ended long ago.
export async function getLiveRunIdsAction({
  workflowId,
  runIds,
}: {
  workflowId: string
  runIds: string[]
}): Promise<string[]> {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")

  Sentry.getIsolationScope().setAttributes({
    action: "getLiveRunIdsAction",
    orgId,
    workflowId,
  })

  // The same two hops as cancelling: the workflow has to be this org's, and
  // each run that workflow's. The answer is only ever a subset of the ids sent,
  // so a run that fails the second hop just drops out of it.
  const workflow = await getWorkflow(orgId, workflowId)
  if (!workflow) throw new Error("Workflow not found")

  const stillLive = await Promise.all(
    runIds.slice(0, MAX_LIVENESS_LOOKUPS).map(async (runId) => {
      const run = await runs.retrieve(runId).catch(() => undefined)

      // Not known to have ended is not ended: answering that would have the
      // canvas resubscribe for nothing. It gives nothing away either, since
      // the id is the caller's own.
      if (!run) return runId

      return isRunOfWorkflow(run, workflowId) && isLiveRunStatus(run.status)
        ? runId
        : undefined
    })
  )

  return stillLive.filter((runId) => runId !== undefined)
}

// A fresh token for a canvas's realtime subscription. The canvas asks for one
// before the token it holds runs out (they last an hour), and when Trigger.dev
// turns it down. Only for this org's workflows, so a browser cannot mint
// itself a way into another org's runs.
export async function createRunsTokenAction(workflowId: string) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")

  Sentry.getIsolationScope().setAttributes({
    action: "createRunsTokenAction",
    orgId,
    workflowId,
  })

  const workflow = await getWorkflow(orgId, workflowId)
  if (!workflow) throw new Error("Workflow not found")

  const token = await createRunsReadToken(workflowId)

  Sentry.logger.info("Realtime runs token refreshed", { orgId, workflowId })

  return token
}
