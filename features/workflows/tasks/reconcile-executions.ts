import { logger, schedules } from "@trigger.dev/sdk"

import { reconcileExecutions } from "@/features/workflows/tasks/execution-reconciler"

// Every 15 minutes, settles the executions whose runs ended without a hook to
// record it (see reconcileExecutions). The schedule is declared here, so it
// syncs with `trigger dev` and with each deploy. In development it only fires
// while the dev CLI is running.
export const reconcileExecutionsTask = schedules.task({
  id: "reconcile-executions",
  cron: "*/15 * * * *",
  // One sweep at a time: a slow one finishes before the next begins, instead
  // of two checking the same rows.
  queue: { concurrencyLimit: 1 },
  // The next sweep is the retry.
  retry: { maxAttempts: 1 },
  maxDuration: 300,
  run: async (payload) => {
    const summary = await reconcileExecutions({ now: payload.timestamp })

    // Anything settled is a run whose hooks missed its ending: worth a look
    // when it is more than the odd one.
    logger.log("Executions reconciled", summary)

    return summary
  },
})
