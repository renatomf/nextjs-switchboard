import { describe, expect, it } from "vitest"

import { summariseRuns, type SettledExecution } from "./run-metrics"

const run = (status: string, seconds?: number): SettledExecution => ({
  status,
  startedAt: seconds === undefined ? null : new Date("2026-09-22T12:00:00Z"),
  finishedAt:
    seconds === undefined
      ? null
      : new Date(new Date("2026-09-22T12:00:00Z").getTime() + seconds * 1000),
})

describe("summariseRuns", () => {
  it("has nothing to say about no runs", () => {
    expect(summariseRuns([])).toMatchObject({
      total: 0,
      successRate: null,
      p50Seconds: null,
      p95Seconds: null,
    })
  })

  describe("the success rate", () => {
    // A cancel is someone clicking Stop. The system did what it was asked, so
    // counting it as a failure would make the number say something it does
    // not mean — and would fall every time a person changed their mind.
    it("leaves cancelled runs out of the denominator", () => {
      const metrics = summariseRuns([
        run("succeeded", 10),
        run("failed", 10),
        run("cancelled", 10),
        run("cancelled", 10),
      ])

      expect(metrics.attempted).toBe(2)
      expect(metrics.successRate).toBe(0.5)
      expect(metrics.cancelled).toBe(2)
    })

    it("says nothing rather than zero when every run was cancelled", () => {
      const metrics = summariseRuns([run("cancelled", 5), run("cancelled", 5)])

      expect(metrics.attempted).toBe(0)
      expect(metrics.successRate).toBeNull()
    })

    it("counts a run with no timestamps in the rate all the same", () => {
      const metrics = summariseRuns([run("succeeded"), run("failed")])

      expect(metrics.successRate).toBe(0.5)
      expect(metrics.timed).toBe(0)
    })
  })

  describe("the durations", () => {
    // Nearest-rank, not interpolated: an SLO should quote a duration a run
    // actually took, not one between two of them.
    it("takes a value that was really observed", () => {
      const seconds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
      const metrics = summariseRuns(seconds.map((s) => run("succeeded", s)))

      expect(metrics.p50Seconds).toBe(5)
      expect(metrics.p95Seconds).toBe(100)
    })

    it("handles a single run", () => {
      expect(summariseRuns([run("succeeded", 42)])).toMatchObject({
        p50Seconds: 42,
        p95Seconds: 42,
      })
    })

    it("measures every run that finished, however it ended", () => {
      const metrics = summariseRuns([run("succeeded", 10), run("failed", 20)])

      expect(metrics.timed).toBe(2)
      expect(metrics.p50Seconds).toBe(10)
    })

    it("ignores a run still going", () => {
      const metrics = summariseRuns([run("succeeded", 10), run("running")])

      expect(metrics.total).toBe(2)
      expect(metrics.timed).toBe(1)
    })

    // Clocks disagree. A finish before its start is a broken record, and
    // averaging it in would drag the number somewhere no run ever was.
    it("drops a run that finished before it started", () => {
      const skewed: SettledExecution = {
        status: "succeeded",
        startedAt: new Date("2026-09-22T12:00:10Z"),
        finishedAt: new Date("2026-09-22T12:00:00Z"),
      }

      expect(summariseRuns([run("succeeded", 30), skewed]).timed).toBe(1)
    })
  })

  it("counts an outcome it does not recognise without breaking", () => {
    const metrics = summariseRuns([run("succeeded", 1), run("expired", 1)])

    expect(metrics.total).toBe(2)
    expect(metrics.succeeded).toBe(1)
    // Not a success and not a cancel, so it counts against the rate.
    expect(metrics.attempted).toBe(2)
    expect(metrics.successRate).toBe(0.5)
  })
})
