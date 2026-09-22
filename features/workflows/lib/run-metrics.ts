// What the executions table can answer about how the platform is doing, and
// nothing it cannot. Pure: it takes rows and returns numbers, so the rules
// below are testable without a database.

// Only the fields the numbers need. A row carries more, and none of it
// belongs in this decision.
export type SettledExecution = {
  status: string
  startedAt: Date | null
  finishedAt: Date | null
}

export type RunMetrics = {
  total: number
  succeeded: number
  failed: number
  cancelled: number
  // Runs the platform owns the outcome of — everything except a cancel.
  attempted: number
  // null rather than 0 when there is nothing to measure: no runs and all runs
  // failing are different facts, and a rate of zero says the second.
  successRate: number | null
  // How many had both timestamps, which is the population the durations
  // describe. Reported so a percentile from three runs is not read as one
  // from three hundred.
  timed: number
  p50Seconds: number | null
  p95Seconds: number | null
}

const SUCCEEDED = "succeeded"
const FAILED = "failed"
const CANCELLED = "cancelled"

// Nearest-rank rather than interpolated: an SLO should quote a duration some
// run actually took, not one sitting between two of them. Postgres's
// percentile_cont interpolates, so a number from here and a number from a
// hand-written query can differ by a second on a small sample — worth knowing
// before treating one as wrong.
function percentileOf(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null

  const rank = Math.max(1, Math.ceil(fraction * sorted.length))

  return sorted[rank - 1]
}

// How long a run took, or nothing when the row cannot say. A finish before its
// start is a broken record — clocks disagree across machines — and averaging
// it in would drag the number somewhere no run ever was.
function secondsOf(execution: SettledExecution): number | null {
  const { startedAt, finishedAt } = execution

  if (!startedAt || !finishedAt) return null

  const seconds = (finishedAt.getTime() - startedAt.getTime()) / 1000

  return seconds < 0 ? null : Math.round(seconds)
}

export function summariseRuns(executions: SettledExecution[]): RunMetrics {
  const succeeded = executions.filter((e) => e.status === SUCCEEDED).length
  const failed = executions.filter((e) => e.status === FAILED).length
  const cancelled = executions.filter((e) => e.status === CANCELLED).length

  // A cancel is a person clicking Stop: the platform did what it was asked, so
  // counting it against the rate would make the number fall every time someone
  // changed their mind. An outcome this does not recognise is not a success,
  // so it counts — a rate that quietly ignores the unfamiliar flatters itself.
  const attempted = executions.length - cancelled

  const durations = executions
    .map(secondsOf)
    .filter((seconds): seconds is number => seconds !== null)
    .sort((a, b) => a - b)

  return {
    total: executions.length,
    succeeded,
    failed,
    cancelled,
    attempted,
    successRate: attempted === 0 ? null : succeeded / attempted,
    timed: durations.length,
    p50Seconds: percentileOf(durations, 0.5),
    p95Seconds: percentileOf(durations, 0.95),
  }
}
