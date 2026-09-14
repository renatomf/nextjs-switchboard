import { beforeEach, describe, expect, it, vi } from "vitest"

import { trackBrowserSession, trackExecution } from "./execution-tracking"

const { advanceExecution, setExecutionBrowserSession, captureException } =
  vi.hoisted(() => ({
    advanceExecution: vi.fn(),
    setExecutionBrowserSession: vi.fn(),
    captureException: vi.fn(),
  }))

vi.mock("@/features/workflows/data", () => ({
  advanceExecution,
  setExecutionBrowserSession,
}))
vi.mock("@sentry/node", () => ({ captureException }))

const payload = { workflowId: "wf_1", orgId: "org_a", versionId: "ver_1" }

describe("trackExecution", () => {
  beforeEach(() => {
    advanceExecution.mockResolvedValue(undefined)
  })

  it("records a hook as a transition of its run's execution", async () => {
    await trackExecution("run_1", payload, "started")

    expect(advanceExecution).toHaveBeenCalledWith({
      runId: "run_1",
      orgId: "org_a",
      workflowId: "wf_1",
      versionId: "ver_1",
      event: "started",
      error: undefined,
    })
  })

  it("keeps the message of what failed the run", async () => {
    await trackExecution("run_1", payload, "failed", new Error("Timed out"))

    expect(advanceExecution).toHaveBeenCalledWith(
      expect.objectContaining({ event: "failed", error: "Timed out" })
    )
  })

  it("caps a long failure message", async () => {
    await trackExecution("run_1", payload, "failed", "x".repeat(5_000))

    const [{ error }] = advanceExecution.mock.calls[0]
    expect(error).toHaveLength(2_000)
  })

  // Trigger.dev ignores errors in most hooks, and one in onStartAttempt would
  // fail the run over a bookkeeping write. A failed write is reported instead.
  it("never throws when the write fails, and reports it", async () => {
    const failure = new Error("connection reset")
    advanceExecution.mockRejectedValue(failure)

    await expect(
      trackExecution("run_1", payload, "succeeded")
    ).resolves.toBeUndefined()
    expect(captureException).toHaveBeenCalledWith(failure, expect.anything())
  })
})

describe("trackBrowserSession", () => {
  it("records the session on the run's execution", async () => {
    setExecutionBrowserSession.mockResolvedValue(undefined)

    await trackBrowserSession("run_1", "bb_1")

    expect(setExecutionBrowserSession).toHaveBeenCalledWith("run_1", "bb_1")
  })

  // Without the session on record the replay route refuses the recording,
  // which is the safe way to fail; the run itself carries on.
  it("never throws when the write fails, and reports it", async () => {
    const failure = new Error("connection reset")
    setExecutionBrowserSession.mockRejectedValue(failure)

    await expect(trackBrowserSession("run_1", "bb_1")).resolves.toBeUndefined()
    expect(captureException).toHaveBeenCalledWith(failure, expect.anything())
  })
})
