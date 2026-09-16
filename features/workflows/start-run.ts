import { runs, tasks } from "@trigger.dev/sdk"

import type { runWorkflowTask } from "@/features/workflows/tasks/run-workflow"
import {
  countOrgRunsSince,
  getLatestUnsettledExecution,
  recordExecution,
  withWorkflowRunLock,
} from "@/features/workflows/data"
import { isLiveRunStatus } from "@/features/workflows/lib/run-liveness"
import {
  isOverRunQuota,
  monthStart,
  runQuotaFor,
} from "@/features/workflows/lib/run-quota"
import { runQueueFor } from "@/features/workflows/lib/run-queues"
import {
  RUN_WORKFLOW_TASK_ID,
  workflowRunTag,
} from "@/features/workflows/lib/run-ownership"

// The run of this workflow still going, if there is one. Under the workflow's
// run lock the executions table is where to look: the start that held the lock
// before this one recorded its run there before letting go, while Trigger.dev's
// run list makes no promise to show a run the moment it is triggered. The row
// is not the whole answer, though: a run that crashed without a hook leaves it
// unsettled, so Trigger.dev confirms the run by id. A run it cannot find (the
// database is shared with another environment, or the run is gone) is not one
// going here.
async function findLiveRun(orgId: string, workflowId: string) {
  const execution = await getLatestUnsettledExecution(orgId, workflowId)
  if (!execution) return undefined

  const run = await runs.retrieve(execution.runId).catch(() => undefined)

  return run && isLiveRunStatus(run.status) ? execution.runId : undefined
}

type StartedRun =
  | { outcome: "already-going"; runId: string }
  // Nothing was started: the org has used the runs its plan allows this
  // month. The numbers come back so the caller can say which they are.
  | { outcome: "over-quota"; used: number; limit: number }
  | {
      outcome: "started"
      runId: string
      versionId: string
      queue: string
      // True when an idempotency key handed this run back instead of starting
      // one: the run already existed, and may well be over.
      isCached: boolean
      // A failed write of the run's execution row. The run is going ahead
      // regardless, and the worker writes the row itself when it starts, so
      // the caller reports this rather than failing over it.
      recordError?: unknown
    }

// Starts a run of a workflow, or hands back the one already going. What the
// Run button and a schedule have in common: both have already checked who may
// run the workflow, and each says which version runs.
//
// At most one run goes per workflow. The canvas assumes it (Run turns into
// Stop, and Stop reaches a single run), so everything from the check to the
// recorded execution happens under the workflow's run lock: without it, two
// starts a second apart both found no run and both started one.
export async function startWorkflowRun({
  orgId,
  workflowId,
  isPro,
  version,
  tags = [],
  idempotencyKey,
}: {
  orgId: string
  workflowId: string
  isPro: boolean
  // The version the run executes, resolved under the lock and only once no
  // run is going, so a start that hands back a live run publishes nothing.
  version: () => Promise<{ id: string }>
  // Beyond the workflow's own tag, which the canvas subscribes by.
  tags?: string[]
  // What stops the same outside event from starting two runs: Trigger.dev
  // hands back the run this key already started instead of starting another.
  // Only a webhook has one — the Run button and a schedule are each their own
  // event.
  idempotencyKey?: string
}): Promise<StartedRun> {
  return withWorkflowRunLock(workflowId, async () => {
    const liveRunId = await findLiveRun(orgId, workflowId)

    if (liveRunId) return { outcome: "already-going", runId: liveRunId }

    // Counted under the lock, like the check above: two starts landing
    // together must not both see the same last slot of the month. A run
    // handed back above costs nothing, since nothing is started.
    const now = new Date()
    const used = await countOrgRunsSince(orgId, monthStart(now))
    const limit = runQuotaFor(isPro)

    // Before publishing: a start that is going to be refused should leave no
    // version behind.
    if (isOverRunQuota(used, isPro)) {
      return { outcome: "over-quota", used, limit }
    }

    const { id: versionId } = await version()

    // On its plan's queue, in that queue's copy for this org: one org's runs
    // cannot take every slot, and a run past the plan's limit waits as queued
    // instead of failing.
    const placement = runQueueFor({ orgId, isPro })

    const handle = await tasks.trigger<typeof runWorkflowTask>(
      RUN_WORKFLOW_TASK_ID,
      { workflowId, orgId, versionId },
      {
        tags: [workflowRunTag(workflowId), ...tags],
        ...placement,
        // Left out entirely when there is none, rather than passed as
        // undefined: the options are compared as a whole in the tests.
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }
    )

    // The run's durable record, as queued. Recorded before the lock is let
    // go, so the next start finds it.
    const recordError = await recordExecution({
      runId: handle.id,
      orgId,
      workflowId,
      versionId,
    }).then(
      () => undefined,
      (error: unknown) => error
    )

    // Trigger.dev sends this on a run an idempotency key matched, but only
    // says so in the type of a batched handle, so it is read for what it is
    // and defaults to "this really is new".
    const { isCached = false } = handle as { isCached?: boolean }

    return {
      outcome: "started",
      runId: handle.id,
      versionId,
      queue: placement.queue,
      isCached,
      recordError,
    }
  })
}
