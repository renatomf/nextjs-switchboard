import { describe, expect, it } from "vitest"

import { isLiveRunStatus, isRealtimeViewStale } from "./run-liveness"

describe("isLiveRunStatus", () => {
  it.each([
    "PENDING_VERSION",
    "QUEUED",
    "DEQUEUED",
    "EXECUTING",
    "WAITING",
    "DELAYED",
  ])("counts %s as a run still going", (status) => {
    expect(isLiveRunStatus(status)).toBe(true)
  })

  it.each([
    "COMPLETED",
    "FAILED",
    "CANCELED",
    "CRASHED",
    "SYSTEM_FAILURE",
    "EXPIRED",
    "TIMED_OUT",
  ])("counts %s as how a run ended", (status) => {
    expect(isLiveRunStatus(status)).toBe(false)
  })
})

// The canvas shows a run as going for as long as its realtime subscription
// says so, and a subscription can go silent without an error: the canvas then
// stays on a run the server has long seen end.
describe("isRealtimeViewStale", () => {
  it("is stale when a run shown as going has ended on the server", () => {
    expect(isRealtimeViewStale(["run_a"], [])).toBe(true)
  })

  it("is stale when any one of the runs shown as going has ended", () => {
    expect(isRealtimeViewStale(["run_a", "run_b"], ["run_a"])).toBe(true)
  })

  it("is not stale while every run shown as going still is", () => {
    expect(isRealtimeViewStale(["run_a"], ["run_a"])).toBe(false)
  })

  // A run the server has that the canvas does not show yet is the realtime
  // view catching up, not a view gone silent.
  it("is not stale when the server knows of a run the canvas has yet to show", () => {
    expect(isRealtimeViewStale(["run_a"], ["run_a", "run_b"])).toBe(false)
  })

  it("is not stale with nothing shown as going", () => {
    expect(isRealtimeViewStale([], [])).toBe(false)
  })
})
