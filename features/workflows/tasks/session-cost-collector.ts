import * as Sentry from "@sentry/node"

import {
  listExecutionsMissingSessionSeconds,
  recordExecutionSessionSeconds,
} from "@/features/workflows/data"
import { sessionSecondsOf } from "@/features/workflows/lib/session-duration"
import { getBrowserbase } from "@/lib/browserbase"

// Sessions read per sweep. Each one is a call to Browserbase, and the next
// sweep picks up whatever this one left.
const BATCH_SIZE = 50

// Collects how long Browserbase kept each run's session open, for the runs
// that have ended and have no duration recorded yet.
//
// It runs after the fact, and not in the run, for two reasons. A session has
// no end until it closes, and the run closes it on its way out — asking there
// would race the close it just asked for. And the worker's own clock is the
// wrong instrument anyway: a session the worker lost stays open, and billed,
// until Browserbase times it out, and only the session knows that.
//
// A run whose session is still closing is simply left for the next sweep. It
// has no end to report yet, and there is no hurry: the row keeps its null and
// the sweep comes back every fifteen minutes.
export async function collectSessionCosts() {
  const pending = await listExecutionsMissingSessionSeconds(BATCH_SIZE)

  const summary = {
    checked: pending.length,
    recorded: 0,
    // Browserbase has not closed the session yet, or reports a pair of stamps
    // that cannot be a duration.
    noDurationYet: 0,
    notFound: 0,
    failedToRecord: 0,
  }

  const browserbase = getBrowserbase()

  // One at a time, like the reconciliation beside it: a sweep has minutes to
  // spare, and fifty parallel calls buy nothing here.
  for (const { runId, browserbaseSessionId } of pending) {
    // Null is filtered out by the query; this is the type narrowing that says
    // so to the compiler.
    if (!browserbaseSessionId) continue

    const session = await browserbase.sessions
      .retrieve(browserbaseSessionId)
      .catch(() => undefined)

    if (!session) {
      // Most likely the other environment's: development and production share
      // one Browserbase project only if they share a key, and a session this
      // cannot find is not this one's to record.
      summary.notFound++
      continue
    }

    const seconds = sessionSecondsOf(session)

    if (seconds === null) {
      summary.noDurationYet++
      continue
    }

    try {
      await recordExecutionSessionSeconds(runId, seconds)
      summary.recorded++
    } catch (error) {
      // The next sweep tries this one again. Reported, since a write that
      // keeps failing leaves the run without a cost for good.
      summary.failedToRecord++
      Sentry.captureException(error, {
        tags: { area: "executions", event: "session-cost" },
        extra: { runId, browserbaseSessionId },
      })
    }
  }

  return summary
}
