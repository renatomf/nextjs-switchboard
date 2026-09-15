"use server"

import * as Sentry from "@sentry/nextjs"
import { auth } from "@clerk/nextjs/server"
import { LiveblocksError } from "@liveblocks/node"
import { runs, schedules } from "@trigger.dev/sdk"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  advanceExecution,
  countOrgSchedules,
  createWorkflow,
  deleteWorkflow,
  deleteWorkflowSchedule,
  deleteWorkflowWebhook,
  getWorkflow,
  getWorkflowSchedule,
  publishWorkflowVersion,
  saveWorkflowSchedule,
  saveWorkflowWebhook,
} from "@/features/workflows/data"
import {
  planRequiredMessage,
  premiumNodeLabels,
} from "@/features/workflows/lib/premium-gate"
import { isLiveRunStatus } from "@/features/workflows/lib/run-liveness"
import { isRunOfWorkflow } from "@/features/workflows/lib/run-ownership"
import { createRunsReadToken } from "@/features/workflows/lib/runs-token"
import {
  cronFor,
  MAX_SCHEDULES_PER_ORG,
  parseScheduleInput,
  SCHEDULED_WORKFLOW_TASK_ID,
  scheduleDeduplicationKey,
} from "@/features/workflows/lib/schedule-presets"
import { triggerEnvironmentOf } from "@/features/workflows/lib/trigger-environment"
import { createWebhookSecret } from "@/features/workflows/lib/webhook-signature"
import { startWorkflowRun } from "@/features/workflows/start-run"
import { PRO_PLAN, PlanRequiredError } from "@/lib/billing"
import { getLiveblocks } from "@/lib/liveblocks"
import { WorkflowGraph, type WorkflowSchedule } from "@/lib/db/schema"

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

type SaveScheduleResult =
  | {
      ok: true
      schedule: Pick<WorkflowSchedule, "preset" | "timezone" | "active">
    }
  | { ok: false; error: string }

// Puts a workflow on a schedule, or changes the schedule it has. Pro only:
// every scheduled run costs a browser session and model calls, with no one
// watching it.
//
// A refusal the user can act on (the plan, the schedule, the org's share of
// schedules) comes back as a result rather than a throw: in production the
// message of a thrown error does not reach the browser.
export async function saveWorkflowScheduleAction({
  workflowId,
  schedule,
  graph,
}: {
  workflowId: string
  // From the browser, so checked here before anything uses it.
  schedule: unknown
  graph: WorkflowGraph
}): Promise<SaveScheduleResult> {
  const { orgId, has } = await auth()
  if (!orgId) throw new Error("No active organization")

  Sentry.getIsolationScope().setAttributes({
    action: "saveWorkflowScheduleAction",
    orgId,
    workflowId,
  })

  if (!has({ plan: PRO_PLAN })) {
    Sentry.logger.warn("Workflow schedule refused — plan", {
      orgId,
      workflowId,
      requiredPlan: PRO_PLAN,
    })
    return {
      ok: false,
      error:
        "Scheduled workflows are part of the Pro plan. Upgrade to schedule this workflow.",
    }
  }

  const parsed = parseScheduleInput(schedule)
  if (!parsed.ok) return { ok: false, error: parsed.problem }

  const { preset, timezone } = parsed.schedule

  const workflow = await getWorkflow(orgId, workflowId)
  if (!workflow) throw new Error("Workflow not found")

  // Development and production share one database, and each has schedules of
  // its own on Trigger.dev.
  const environment = triggerEnvironmentOf(process.env.TRIGGER_SECRET_KEY)
  const existing = await getWorkflowSchedule(orgId, workflowId, environment)

  // The project's Trigger.dev plan allows a handful of schedules in all. A
  // workflow already scheduled can always change its schedule.
  if (
    !existing &&
    (await countOrgSchedules(orgId, environment)) >= MAX_SCHEDULES_PER_ORG
  ) {
    return {
      ok: false,
      error: `An organization can have up to ${MAX_SCHEDULES_PER_ORG} scheduled workflows. Remove a schedule to add this one.`,
    }
  }

  // The canvas as it is now becomes the version the schedule runs, so the first
  // scheduled run executes what the user just saw. Publishing re-runs
  // validateGraph too.
  await publishWorkflowVersion({ orgId, workflowId, graph })

  const cron = cronFor(preset)

  // Creating with a deduplication key Trigger.dev already has updates that
  // schedule instead, so this one call both creates and changes it.
  const created = await schedules.create({
    task: SCHEDULED_WORKFLOW_TASK_ID,
    cron,
    timezone,
    externalId: workflowId,
    deduplicationKey: scheduleDeduplicationKey(environment, workflowId),
  })

  // Turned off by a run that found the org no longer on Pro. Saving it again,
  // once back on Pro, turns it back on.
  if (!created.active) await schedules.activate(created.id)

  const saved = await saveWorkflowSchedule({
    orgId,
    workflowId,
    environment,
    preset,
    timezone,
    triggerScheduleId: created.id,
  })

  Sentry.logger.info("Workflow schedule saved", {
    orgId,
    workflowId,
    environment,
    cron,
    timezone,
  })

  return {
    ok: true,
    schedule: { preset: saved.preset, timezone: saved.timezone, active: true },
  }
}

// Takes a workflow off its schedule. Open to any plan: an org that left Pro can
// still turn off what it scheduled while on it.
export async function deleteWorkflowScheduleAction(workflowId: string) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")

  Sentry.getIsolationScope().setAttributes({
    action: "deleteWorkflowScheduleAction",
    orgId,
    workflowId,
  })

  const workflow = await getWorkflow(orgId, workflowId)
  if (!workflow) throw new Error("Workflow not found")

  const environment = triggerEnvironmentOf(process.env.TRIGGER_SECRET_KEY)
  const existing = await getWorkflowSchedule(orgId, workflowId, environment)
  if (!existing) return

  // A schedule already gone on Trigger.dev, removed by hand or by a run that
  // found no record of it, still has its record removed. Any other failure
  // keeps the record, since it is what lets a second try remove the schedule.
  await schedules.del(existing.triggerScheduleId).catch((error: unknown) => {
    const status =
      typeof error === "object" && error !== null
        ? (error as { status?: unknown }).status
        : undefined

    if (status !== 404) throw error
  })

  await deleteWorkflowSchedule(orgId, workflowId, environment)

  Sentry.logger.info("Workflow schedule removed", {
    orgId,
    workflowId,
    environment,
  })
}

type WebhookResult = { ok: true; secret: string } | { ok: false; error: string }

// Gives a workflow a webhook, or replaces the secret of the one it has. Pro
// only, like a schedule: a webhook lets anything outside start runs, and each
// one costs a browser session and model calls.
//
// The secret goes back to the caller once, here, and into no log: from then
// on it only ever arrives as a signature to check against.
export async function createWorkflowWebhookAction(
  workflowId: string
): Promise<WebhookResult> {
  const { orgId, has } = await auth()
  if (!orgId) throw new Error("No active organization")

  Sentry.getIsolationScope().setAttributes({
    action: "createWorkflowWebhookAction",
    orgId,
    workflowId,
  })

  if (!has({ plan: PRO_PLAN })) {
    Sentry.logger.warn("Workflow webhook refused — plan", {
      orgId,
      workflowId,
      requiredPlan: PRO_PLAN,
    })
    return {
      ok: false,
      error:
        "Webhook triggers are part of the Pro plan. Upgrade to start this workflow from outside.",
    }
  }

  const workflow = await getWorkflow(orgId, workflowId)
  if (!workflow) throw new Error("Workflow not found")

  // A fresh secret every time, which is what rotating a leaked one has to do:
  // the caller holding the old secret stops getting in.
  const secret = createWebhookSecret()

  await saveWorkflowWebhook({ orgId, workflowId, secret })

  Sentry.logger.info("Workflow webhook secret set", { orgId, workflowId })

  return { ok: true, secret }
}

// Closes a workflow's way in from outside. Open to any plan: an org that left
// Pro still has to be able to shut it.
export async function deleteWorkflowWebhookAction(workflowId: string) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")

  Sentry.getIsolationScope().setAttributes({
    action: "deleteWorkflowWebhookAction",
    orgId,
    workflowId,
  })

  const workflow = await getWorkflow(orgId, workflowId)
  if (!workflow) throw new Error("Workflow not found")

  await deleteWorkflowWebhook(orgId, workflowId)

  Sentry.logger.info("Workflow webhook removed", { orgId, workflowId })
}
