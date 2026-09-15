import * as Sentry from "@sentry/node"
import { runs } from "@trigger.dev/sdk"

import {
  advanceExecution,
  listUnsettledExecutions,
} from "@/features/workflows/data"
import { endingForRunStatus } from "@/features/workflows/lib/execution-status"

// How long a run's own hooks get to record how it went before the
// reconciliation looks. A run just triggered, or one that just ended, is
// theirs to write.
const GRACE_MS = 10 * 60_000

// Executions checked per sweep. Each one is a call to Trigger.dev, and the
// next sweep picks up whatever this one left.
const BATCH_SIZE = 50

// Capped like a step's error, so one runaway message cannot bloat the row.
const ERROR_CHAR_CAP = 2_000

// Settles the executions whose runs ended without a hook to say so. The hooks
// miss some endings by design: onFailure does not run for a crashed worker or
// a platform failure, onCancel not for a run cancelled in the queue, and any
// hook's write can fail. Such an execution stays "running" for good, and this
// asks Trigger.dev how its run actually ended.
//
// Only the run decides: an execution is left alone while its run is still
// going, however long ago it began, and when the run cannot be found. The
// database is shared by development and production, and each environment only
// sees its own runs, so a run this cannot find is most likely the other's.
//
// Every write goes through advanceExecution, the same guarded upsert as the
// hooks, so an ending a hook recorded in the meantime is never rewritten.
export async function reconcileExecutions({ now }: { now: Date }) {
  const unsettled = await listUnsettledExecutions({
    createdBefore: new Date(now.getTime() - GRACE_MS),
    limit: BATCH_SIZE,
  })

  const summary = {
    checked: unsettled.length,
    settled: 0,
    // Includes a run in a status endingForRunStatus does not know.
    stillGoing: 0,
    notFound: 0,
    failedToRecord: 0,
  }

  // One at a time: a sweep has minutes to spare, and there is no reason to
  // hit Trigger.dev's API with fifty calls at once.
  for (const { runId, orgId, workflowId, versionId } of unsettled) {
    const run = await runs.retrieve(runId).catch(() => undefined)

    if (!run) {
      summary.notFound++
      continue
    }

    const ending = endingForRunStatus(run.status)

    if (!ending) {
      summary.stillGoing++
      continue
    }

    try {
      await advanceExecution({
        runId,
        orgId,
        workflowId,
        versionId: versionId ?? undefined,
        event: ending,
        // When the run ended, not when the sweep noticed.
        at: run.finishedAt ?? now,
        error: run.error?.message.slice(0, ERROR_CHAR_CAP),
      })
      summary.settled++
    } catch (error) {
      // The next sweep tries this one again. Reported, since a write that
      // keeps failing leaves the execution behind for good.
      summary.failedToRecord++
      Sentry.captureException(error, {
        tags: { area: "executions", event: "reconcile" },
        extra: { runId },
      })
    }
  }

  return summary
}
