import { beforeEach, describe, expect, it, vi } from "vitest"

import { reconcileExecutions } from "./execution-reconciler"

const {
  listUnsettledExecutions,
  advanceExecution,
  retrieveRun,
  captureException,
} = vi.hoisted(() => ({
  listUnsettledExecutions: vi.fn(),
  advanceExecution: vi.fn(),
  retrieveRun: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock("@/features/workflows/data", () => ({
  listUnsettledExecutions,
  advanceExecution,
}))
vi.mock("@trigger.dev/sdk", () => ({ runs: { retrieve: retrieveRun } }))
vi.mock("@sentry/node", () => ({ captureException }))

const now = new Date("2026-09-15T12:00:00Z")
const finishedAt = new Date("2026-09-15T11:20:00Z")

// An execution left behind: still "running" in the table.
const execution = (runId: string) => ({
  runId,
  orgId: "org_a",
  workflowId: "wf_1",
  versionId: "ver_1",
})

describe("reconcileExecutions", () => {
  beforeEach(() => {
    listUnsettledExecutions.mockResolvedValue([execution("run_1")])
    retrieveRun.mockResolvedValue({ status: "COMPLETED", finishedAt })
    advanceExecution.mockResolvedValue(undefined)
  })

  // A run that ended without a hook: a crashed worker, a platform failure, a
  // hook whose write failed.
  it("records how a run ended when its execution never heard", async () => {
    await reconcileExecutions({ now })

    expect(retrieveRun).toHaveBeenCalledWith("run_1")
    expect(advanceExecution).toHaveBeenCalledWith({
      runId: "run_1",
      orgId: "org_a",
      workflowId: "wf_1",
      versionId: "ver_1",
      event: "succeeded",
      // When the run ended, not when this noticed.
      at: finishedAt,
      error: undefined,
    })
  })

  it("keeps the error of a run that broke", async () => {
    retrieveRun.mockResolvedValue({
      status: "CRASHED",
      finishedAt,
      error: { message: "Worker crashed" },
    })

    await reconcileExecutions({ now })

    expect(advanceExecution).toHaveBeenCalledWith(
      expect.objectContaining({ event: "failed", error: "Worker crashed" })
    )
  })

  it("caps a long error", async () => {
    retrieveRun.mockResolvedValue({
      status: "FAILED",
      finishedAt,
      error: { message: "x".repeat(5_000) },
    })

    await reconcileExecutions({ now })

    expect(advanceExecution.mock.calls[0][0].error).toHaveLength(2_000)
  })

  it("dates the ending now when Trigger.dev gives no end time", async () => {
    retrieveRun.mockResolvedValue({ status: "CANCELED" })

    await reconcileExecutions({ now })

    expect(advanceExecution).toHaveBeenCalledWith(
      expect.objectContaining({ event: "cancelled", at: now })
    )
  })

  // A run can wait in the queue, or execute, for a long time. Only how the
  // run itself stands decides, never how long ago it began.
  it("leaves a run that is still going", async () => {
    retrieveRun.mockResolvedValue({ status: "EXECUTING" })

    await expect(reconcileExecutions({ now })).resolves.toMatchObject({
      stillGoing: 1,
    })
    expect(advanceExecution).not.toHaveBeenCalled()
  })

  // Development and production share one database, and each environment only
  // sees its own runs: a run it cannot find is most likely the other's.
  it("leaves a run it cannot find", async () => {
    retrieveRun.mockRejectedValue(new Error("Run not found"))

    await expect(reconcileExecutions({ now })).resolves.toMatchObject({
      notFound: 1,
    })
    expect(advanceExecution).not.toHaveBeenCalled()
  })

  // A run just triggered, or just ended, is its hooks' to record. The newest
  // go first, so the rows no sweep can settle (the other environment's) do
  // not keep a run that stalled today waiting behind them.
  it("looks at executions unsettled for 10 minutes, newest first, 50 at a time", async () => {
    await reconcileExecutions({ now })

    expect(listUnsettledExecutions).toHaveBeenCalledWith({
      createdBefore: new Date("2026-09-15T11:50:00Z"),
      limit: 50,
    })
  })

  it("carries on past an execution it could not record, and reports it", async () => {
    listUnsettledExecutions.mockResolvedValue([
      execution("run_1"),
      execution("run_2"),
    ])
    const failure = new Error("connection reset")
    advanceExecution.mockRejectedValueOnce(failure)

    await expect(reconcileExecutions({ now })).resolves.toEqual({
      checked: 2,
      settled: 1,
      stillGoing: 0,
      notFound: 0,
      failedToRecord: 1,
    })
    expect(advanceExecution).toHaveBeenCalledTimes(2)
    expect(captureException).toHaveBeenCalledWith(failure, expect.anything())
  })

  // Written before versions existed, the column is null in old rows.
  it("records a run with no version", async () => {
    listUnsettledExecutions.mockResolvedValue([
      { ...execution("run_1"), versionId: null },
    ])

    await reconcileExecutions({ now })

    expect(advanceExecution).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: undefined })
    )
  })
})
