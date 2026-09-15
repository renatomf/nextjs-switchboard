import { runs, tasks } from "@trigger.dev/sdk"

import type { runWorkflowTask } from "@/features/workflows/tasks/run-workflow"
import {
  getLatestUnsettledExecution,
  recordExecution,
  withWorkflowRunLock,
} from "@/features/workflows/data"
import { isLiveRunStatus } from "@/features/workflows/lib/run-liveness"
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
  | { alreadyGoing: true; runId: string }
  | {
      alreadyGoing: false
      runId: string
      versionId: string
      queue: string
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
}: {
  orgId: string
  workflowId: string
  isPro: boolean
  // The version the run executes, resolved under the lock and only once no
  // run is going, so a start that hands back a live run publishes nothing.
  version: () => Promise<{ id: string }>
  // Beyond the workflow's own tag, which the canvas subscribes by.
  tags?: string[]
}): Promise<StartedRun> {
  return withWorkflowRunLock(workflowId, async () => {
    const liveRunId = await findLiveRun(orgId, workflowId)

    if (liveRunId) return { alreadyGoing: true, runId: liveRunId }

    const { id: versionId } = await version()

    // On its plan's queue, in that queue's copy for this org: one org's runs
    // cannot take every slot, and a run past the plan's limit waits as queued
    // instead of failing.
    const placement = runQueueFor({ orgId, isPro })

    const handle = await tasks.trigger<typeof runWorkflowTask>(
      RUN_WORKFLOW_TASK_ID,
      { workflowId, orgId, versionId },
      { tags: [workflowRunTag(workflowId), ...tags], ...placement }
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

    return {
      alreadyGoing: false,
      runId: handle.id,
      versionId,
      queue: placement.queue,
      recordError,
    }
  })
}
