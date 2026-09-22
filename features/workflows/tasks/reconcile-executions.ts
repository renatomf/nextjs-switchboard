import { logger, schedules } from "@trigger.dev/sdk"

import { reconcileExecutions } from "@/features/workflows/tasks/execution-reconciler"
import { collectSessionCosts } from "@/features/workflows/tasks/session-cost-collector"

// Every 15 minutes, settles the executions whose runs ended without a hook to
// record it (see reconcileExecutions), then collects what Browserbase charged
// for the sessions of the runs that have ended (see collectSessionCosts). The
// schedule is declared here, so it syncs with `trigger dev` and with each
// deploy. In development it only fires while the dev CLI is running.
//
// Two jobs on one schedule because they want the same thing: a look at runs
// that have ended, a little after they ended. Settling first is deliberate —
// a run this sweep settles becomes eligible for its cost in the same pass
// rather than waiting another fifteen minutes.
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
    const reconciled = await reconcileExecutions({ now: payload.timestamp })

    // Anything settled is a run whose hooks missed its ending: worth a look
    // when it is more than the odd one.
    logger.log("Executions reconciled", reconciled)

    // Its own failure, so a Browserbase outage costs the sweep its cost
    // collection and not its reconciliation, which is the half that keeps the
    // executions table honest.
    const sessionCosts = await collectSessionCosts().catch((error) => {
      logger.error("Session costs not collected", { error })
      return undefined
    })

    if (sessionCosts) logger.log("Session costs collected", sessionCosts)

    return { reconciled, sessionCosts }
  },
})
