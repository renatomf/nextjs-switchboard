// What the executions table can answer about how the platform is doing, and
// nothing it cannot. Pure: it takes rows and returns numbers, so the rules
// below are testable without a database.

// Only the fields the numbers need. A row carries more, and none of it
// belongs in this decision. `createdAt` is never null — the row is written
// with it — while the other two are only known once the run gets that far.
export type SettledExecution = {
  status: string
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

// One span, measured over whatever population could report it.
export type DurationSummary = {
  // How many rows could be measured, which is the population the percentiles
  // describe. Reported so a percentile from three runs is not read as one
  // from three hundred — and so the three spans below can be compared
  // knowing they do not cover the same runs.
  timed: number
  p50Seconds: number | null
  p95Seconds: number | null
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
  // How long the worker was busy. What the platform does.
  execution: DurationSummary
  // How long the person waited, from clicking Run to the run ending. What the
  // person gets. Wider than `execution`: a run rejected before any worker
  // picked it up still made someone wait.
  perceived: DurationSummary
  // The gap between the two — queue time plus cold start. Measured directly
  // rather than by subtracting the percentiles above, because the run sitting
  // at the 95th of one series need not be the run at the 95th of another, so
  // the difference of two percentiles describes no run at all.
  wait: DurationSummary
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

// The seconds between two stamps, or nothing when the row cannot say. An end
// before its beginning is a broken record — clocks disagree across machines —
// and averaging it in would drag the number somewhere no run ever was.
function secondsBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null

  const seconds = (to.getTime() - from.getTime()) / 1000

  return seconds < 0 ? null : Math.round(seconds)
}

function summariseSpan(
  executions: SettledExecution[],
  span: (execution: SettledExecution) => number | null
): DurationSummary {
  const seconds = executions
    .map(span)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)

  return {
    timed: seconds.length,
    p50Seconds: percentileOf(seconds, 0.5),
    p95Seconds: percentileOf(seconds, 0.95),
  }
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

  return {
    total: executions.length,
    succeeded,
    failed,
    cancelled,
    attempted,
    successRate: attempted === 0 ? null : succeeded / attempted,
    execution: summariseSpan(executions, (e) =>
      secondsBetween(e.startedAt, e.finishedAt)
    ),
    perceived: summariseSpan(executions, (e) =>
      secondsBetween(e.createdAt, e.finishedAt)
    ),
    wait: summariseSpan(executions, (e) =>
      secondsBetween(e.createdAt, e.startedAt)
    ),
  }
}
