import { describe, expect, it } from "vitest"

import {
  allowedFrom,
  EXECUTION_STATUSES,
  isTerminal,
  nextStatus,
  type ExecutionEvent,
} from "./execution-status"

const EVENTS: ExecutionEvent[] = ["started", "succeeded", "failed", "cancelled"]

describe("nextStatus", () => {
  it("starts a queued execution", () => {
    expect(nextStatus("queued", "started")).toBe("running")
  })

  it.each([
    ["succeeded", "succeeded"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
  ] as const)("ends a running execution when it %s", (event, status) => {
    expect(nextStatus("running", event)).toBe(status)
  })

  // The start hook can be missed (its write failed, or the run was cancelled
  // before a worker picked it up), so an execution may end straight from the
  // queue.
  it.each(["succeeded", "failed", "cancelled"] as const)(
    "ends a queued execution when it %s",
    (event) => {
      expect(nextStatus("queued", event)).toBe(event)
    }
  )

  it("ignores a second start", () => {
    expect(nextStatus("running", "started")).toBeNull()
  })

  // Hooks can fire late or twice, and the cancel action races the worker.
  // Whatever arrives after the end must not rewrite it.
  it.each(["succeeded", "failed", "cancelled"] as const)(
    "never changes a %s execution",
    (status) => {
      for (const event of EVENTS) expect(nextStatus(status, event)).toBeNull()
    }
  )
})

describe("isTerminal", () => {
  it("marks the three endings as terminal", () => {
    expect(EXECUTION_STATUSES.filter(isTerminal)).toEqual([
      "succeeded",
      "failed",
      "cancelled",
    ])
  })
})

// The database applies transitions with a guarded UPDATE whose WHERE clause
// comes from allowedFrom. It has to agree with nextStatus on every pair, or
// the SQL and the rule drift apart.
describe("allowedFrom", () => {
  it("agrees with nextStatus for every status and event", () => {
    for (const event of EVENTS) {
      for (const status of EXECUTION_STATUSES) {
        expect(allowedFrom(event).includes(status)).toBe(
          nextStatus(status, event) !== null
        )
      }
    }
  })
})
