import { logger, schedules } from "@trigger.dev/sdk"

import { listExecutionsSince } from "@/features/workflows/data"
import { summariseRuns } from "@/features/workflows/lib/run-metrics"

// A week of runs, which is the window the report covers.
const WINDOW_DAYS = 7

// Once a week rather than often: these numbers move slowly, and a schedule
// that fires every few minutes would spend runs to say the same thing. Monday
// morning, so the week starts with the week before it in view.
//
// The report carries three spans, not one. `execution` is the worker being
// busy; `perceived` is the whole wait from clicking Run; `wait` is the queue
// and cold start between them. The first production report showed 14 s of
// waiting for 767 ms of work — reporting only `execution` would say those
// seconds never happened.
//
// What this deliberately does not report is cost per execution — the roadmap
// asks for it and nothing records it. A run opens a Browserbase session and
// makes model calls, and neither duration nor token count reaches this
// database. Reporting a guess would be worse than reporting nothing.
export const reportRunMetricsTask = schedules.task({
  id: "report-run-metrics",
  cron: "0 9 * * 1",
  queue: { concurrencyLimit: 1 },
  // Nothing depends on this arriving; next week's report is the retry.
  retry: { maxAttempts: 1 },
  maxDuration: 120,
  run: async (payload) => {
    const since = new Date(
      payload.timestamp.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000
    )

    const metrics = summariseRuns(await listExecutionsSince(since))

    // One wide event rather than a metric per line: everything worth
    // correlating about the week is knowable at once, and a rate is only
    // readable next to the count it came from.
    logger.log("Run metrics for the week", {
      ...metrics,
      since: since.toISOString(),
      windowDays: WINDOW_DAYS,
    })

    return metrics
  },
})
