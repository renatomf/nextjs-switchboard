import { describe, expect, it } from "vitest"

import {
  nextStepStatus,
  STEP_EVENTS,
  STEP_STATUSES,
  type StepEvent,
  type StepStatus,
} from "./step-status"

describe("nextStepStatus", () => {
  it.each<[StepStatus, StepEvent, StepStatus]>([
    ["pending", "started", "running"],
    ["running", "succeeded", "done"],
    ["running", "failed", "failed"],
    ["running", "cancelled", "cancelled"],
    ["skipped", "passed", "done"],
  ])("moves a %s step on %s to %s", (from, event, to) => {
    expect(nextStepStatus(from, event)).toBe(to)
  })

  // A settled step is history: a late write, or a bug, cannot rewrite how it
  // ended.
  it.each<StepStatus>(["done", "failed", "cancelled"])(
    "never moves a %s step",
    (status) => {
      for (const event of STEP_EVENTS) {
        expect(nextStepStatus(status, event)).toBeNull()
      }
    }
  )

  it("does not let a step finish without having started", () => {
    expect(nextStepStatus("pending", "succeeded")).toBeNull()
    expect(nextStepStatus("pending", "failed")).toBeNull()
  })

  // The steps a stopped run never reached did not run, and keep saying so.
  it("leaves a step the run never reached pending on a cancel", () => {
    expect(nextStepStatus("pending", "cancelled")).toBeNull()
  })

  // The trigger is where the run starts, not work it does.
  it("lets the trigger be passed, never run", () => {
    expect(nextStepStatus("skipped", "started")).toBeNull()
    expect(nextStepStatus("pending", "passed")).toBeNull()
  })

  it("allows exactly the transitions above and nothing else", () => {
    const allowed = STEP_STATUSES.flatMap((from) =>
      STEP_EVENTS.filter((event) => nextStepStatus(from, event) !== null).map(
        (event) => `${from} + ${event}`
      )
    )

    expect(allowed.sort()).toEqual(
      [
        "pending + started",
        "running + cancelled",
        "running + failed",
        "running + succeeded",
        "skipped + passed",
      ].sort()
    )
  })
})
