import { beforeEach, describe, expect, it, vi } from "vitest"

import { collectSessionCosts } from "./session-cost-collector"

const {
  listExecutionsMissingSessionSeconds,
  recordExecutionSessionSeconds,
  retrieveSession,
  captureException,
} = vi.hoisted(() => ({
  listExecutionsMissingSessionSeconds: vi.fn(),
  recordExecutionSessionSeconds: vi.fn(),
  retrieveSession: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock("@/features/workflows/data", () => ({
  listExecutionsMissingSessionSeconds,
  recordExecutionSessionSeconds,
}))
vi.mock("@/lib/browserbase", () => ({
  getBrowserbase: () => ({ sessions: { retrieve: retrieveSession } }),
}))
vi.mock("@sentry/node", () => ({ captureException }))

// A run that ended having opened a session, with no duration recorded yet.
const pending = (runId: string, sessionId = `sess_${runId}`) => ({
  runId,
  browserbaseSessionId: sessionId,
})

const closedSession = (seconds: number) => ({
  startedAt: "2026-09-22T12:00:00Z",
  endedAt: new Date(
    new Date("2026-09-22T12:00:00Z").getTime() + seconds * 1000
  ).toISOString(),
})

beforeEach(() => {
  vi.clearAllMocks()
  listExecutionsMissingSessionSeconds.mockResolvedValue([])
  recordExecutionSessionSeconds.mockResolvedValue(undefined)
})

describe("collectSessionCosts", () => {
  it("has nothing to do when no run is waiting for a duration", async () => {
    const summary = await collectSessionCosts()

    expect(summary.checked).toBe(0)
    expect(retrieveSession).not.toHaveBeenCalled()
  })

  it("records how long a closed session was open", async () => {
    listExecutionsMissingSessionSeconds.mockResolvedValue([pending("run_a")])
    retrieveSession.mockResolvedValue(closedSession(150))

    const summary = await collectSessionCosts()

    expect(retrieveSession).toHaveBeenCalledWith("sess_run_a")
    expect(recordExecutionSessionSeconds).toHaveBeenCalledWith("run_a", 150)
    expect(summary).toMatchObject({ checked: 1, recorded: 1 })
  })

  // The run has settled but Browserbase has not finished closing the session.
  // Leaving the row null is what brings the next sweep back to it.
  it("leaves a session that has not closed for the next sweep", async () => {
    listExecutionsMissingSessionSeconds.mockResolvedValue([pending("run_a")])
    retrieveSession.mockResolvedValue({ startedAt: "2026-09-22T12:00:00Z" })

    const summary = await collectSessionCosts()

    expect(recordExecutionSessionSeconds).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ noDurationYet: 1, recorded: 0 })
  })

  it("passes over a session Browserbase does not know", async () => {
    listExecutionsMissingSessionSeconds.mockResolvedValue([pending("run_a")])
    retrieveSession.mockRejectedValue(new Error("404 not found"))

    const summary = await collectSessionCosts()

    expect(recordExecutionSessionSeconds).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ notFound: 1 })
  })

  // One unreadable session must not cost the sweep the rest of the batch.
  it("keeps going after a session it could not read", async () => {
    listExecutionsMissingSessionSeconds.mockResolvedValue([
      pending("run_a"),
      pending("run_b"),
    ])
    retrieveSession
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(closedSession(30))

    const summary = await collectSessionCosts()

    expect(recordExecutionSessionSeconds).toHaveBeenCalledWith("run_b", 30)
    expect(summary).toMatchObject({ checked: 2, recorded: 1, notFound: 1 })
  })

  // A write that keeps failing leaves the run without a cost for good, so it
  // is reported rather than only counted.
  it("reports a write it could not make and carries on", async () => {
    listExecutionsMissingSessionSeconds.mockResolvedValue([
      pending("run_a"),
      pending("run_b"),
    ])
    retrieveSession.mockResolvedValue(closedSession(10))
    recordExecutionSessionSeconds
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(undefined)

    const summary = await collectSessionCosts()

    expect(summary).toMatchObject({ failedToRecord: 1, recorded: 1 })
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  // The known case the whole collector exists for: the worker died without
  // cancelling, and Browserbase billed until its own timeout. The duration
  // recorded is the session's, not the run's.
  it("records the full time a lost session stayed open", async () => {
    listExecutionsMissingSessionSeconds.mockResolvedValue([pending("run_a")])
    retrieveSession.mockResolvedValue(closedSession(300))

    await collectSessionCosts()

    expect(recordExecutionSessionSeconds).toHaveBeenCalledWith("run_a", 300)
  })
})
