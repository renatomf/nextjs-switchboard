import { describe, expect, it } from "vitest"

import { summariseRuns, type SettledExecution } from "./run-metrics"

const BASE = new Date("2026-09-22T12:00:00Z")
const at = (seconds: number) => new Date(BASE.getTime() + seconds * 1000)

// A run described by when it was asked for, when work began and when it
// ended, in seconds from an arbitrary base. Leaving out `started` or
// `finished` says the run never got there.
const run = (
  status: string,
  {
    created = 0,
    started,
    finished,
  }: { created?: number; started?: number; finished?: number } = {}
): SettledExecution => ({
  status,
  createdAt: at(created),
  startedAt: started === undefined ? null : at(started),
  finishedAt: finished === undefined ? null : at(finished),
})

// The common shape: work started the moment it was asked for, so the only
// interesting number is how long it took.
const took = (status: string, seconds: number) =>
  run(status, { started: 0, finished: seconds })

describe("summariseRuns", () => {
  it("has nothing to say about no runs", () => {
    expect(summariseRuns([])).toMatchObject({
      total: 0,
      successRate: null,
      execution: { timed: 0, p50Seconds: null, p95Seconds: null },
      perceived: { timed: 0, p50Seconds: null, p95Seconds: null },
      wait: { timed: 0, p50Seconds: null, p95Seconds: null },
    })
  })

  describe("the success rate", () => {
    // A cancel is someone clicking Stop. The system did what it was asked, so
    // counting it as a failure would make the number say something it does
    // not mean — and would fall every time a person changed their mind.
    it("leaves cancelled runs out of the denominator", () => {
      const metrics = summariseRuns([
        took("succeeded", 10),
        took("failed", 10),
        took("cancelled", 10),
        took("cancelled", 10),
      ])

      expect(metrics.attempted).toBe(2)
      expect(metrics.successRate).toBe(0.5)
      expect(metrics.cancelled).toBe(2)
    })

    it("says nothing rather than zero when every run was cancelled", () => {
      const metrics = summariseRuns([
        took("cancelled", 5),
        took("cancelled", 5),
      ])

      expect(metrics.attempted).toBe(0)
      expect(metrics.successRate).toBeNull()
    })

    it("counts a run with no timestamps in the rate all the same", () => {
      const metrics = summariseRuns([run("succeeded"), run("failed")])

      expect(metrics.successRate).toBe(0.5)
      expect(metrics.execution.timed).toBe(0)
    })
  })

  describe("the execution durations", () => {
    // Nearest-rank, not interpolated: an SLO should quote a duration a run
    // actually took, not one between two of them.
    it("takes a value that was really observed", () => {
      const seconds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
      const metrics = summariseRuns(seconds.map((s) => took("succeeded", s)))

      expect(metrics.execution.p50Seconds).toBe(5)
      expect(metrics.execution.p95Seconds).toBe(100)
    })

    it("handles a single run", () => {
      expect(summariseRuns([took("succeeded", 42)]).execution).toMatchObject({
        p50Seconds: 42,
        p95Seconds: 42,
      })
    })

    it("measures every run that finished, however it ended", () => {
      const metrics = summariseRuns([took("succeeded", 10), took("failed", 20)])

      expect(metrics.execution.timed).toBe(2)
      expect(metrics.execution.p50Seconds).toBe(10)
    })

    it("ignores a run still going", () => {
      const metrics = summariseRuns([took("succeeded", 10), run("running")])

      expect(metrics.total).toBe(2)
      expect(metrics.execution.timed).toBe(1)
    })

    // Clocks disagree. A finish before its start is a broken record, and
    // averaging it in would drag the number somewhere no run ever was.
    it("drops a run that finished before it started", () => {
      const skewed = run("succeeded", { started: 10, finished: 0 })

      expect(
        summariseRuns([took("succeeded", 30), skewed]).execution.timed
      ).toBe(1)
    })
  })

  describe("the perceived latency", () => {
    // The case that put this on the roadmap: the first production report
    // showed 14 s between the task being asked for and the first attempt
    // running, for under a second of work. Whoever clicked Run waited for all
    // of it, and the execution series alone would say those seconds never
    // happened.
    it("counts the waiting the execution duration leaves out", () => {
      const metrics = summariseRuns([
        run("succeeded", { created: 0, started: 14, finished: 15 }),
      ])

      expect(metrics.execution.p50Seconds).toBe(1)
      expect(metrics.perceived.p50Seconds).toBe(15)
      expect(metrics.wait.p50Seconds).toBe(14)
    })

    // A run rejected before a worker ever picked it up still made someone
    // wait, so it belongs to the perceived series even though there is no
    // execution to measure.
    it("measures a run that finished without ever starting", () => {
      const metrics = summariseRuns([run("failed", { finished: 3 })])

      expect(metrics.execution.timed).toBe(0)
      expect(metrics.perceived.timed).toBe(1)
      expect(metrics.perceived.p50Seconds).toBe(3)
      expect(metrics.wait.timed).toBe(0)
    })

    it("measures the wait of a run whose work is still going", () => {
      const metrics = summariseRuns([run("running", { started: 8 })])

      expect(metrics.perceived.timed).toBe(0)
      expect(metrics.wait.timed).toBe(1)
      expect(metrics.wait.p50Seconds).toBe(8)
    })

    it("drops a run that finished before it was asked for", () => {
      const metrics = summariseRuns([
        run("succeeded", { created: 10, started: 10, finished: 0 }),
      ])

      expect(metrics.perceived.timed).toBe(0)
    })

    it("drops a run that started before it was asked for", () => {
      const metrics = summariseRuns([
        run("succeeded", { created: 10, started: 0, finished: 20 }),
      ])

      expect(metrics.wait.timed).toBe(0)
      // The execution is still a sound record: work began and it ended.
      expect(metrics.execution.timed).toBe(1)
    })

    // Why the wait is its own series and not a subtraction. Nothing says the
    // run at the 95th percentile of one series is the run at the 95th of
    // another, so subtracting the percentiles describes no run at all.
    it("does not report a wait that subtracting the percentiles would miss", () => {
      const metrics = summariseRuns([
        run("succeeded", { created: 0, started: 0, finished: 100 }),
        run("succeeded", { created: 0, started: 50, finished: 60 }),
      ])

      expect(metrics.execution.p95Seconds).toBe(100)
      expect(metrics.perceived.p95Seconds).toBe(100)
      // Subtracting those two would say nobody waited. One run waited 50 s.
      expect(metrics.wait.p95Seconds).toBe(50)
    })
  })

  it("counts an outcome it does not recognise without breaking", () => {
    const metrics = summariseRuns([took("succeeded", 1), took("expired", 1)])

    expect(metrics.total).toBe(2)
    expect(metrics.succeeded).toBe(1)
    // Not a success and not a cancel, so it counts against the rate.
    expect(metrics.attempted).toBe(2)
    expect(metrics.successRate).toBe(0.5)
  })
})
