import { describe, expect, it } from "vitest"

import type { RunStep } from "@/features/workflows/engine/run-steps"
import { toWorkflowRun, type RunSnapshot } from "./to-workflow-run"

// A run in no particular state. Each test sets the flags it is about.
function run(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    isQueued: false,
    isExecuting: false,
    isWaiting: false,
    isCancelled: false,
    isFailed: false,
    ...overrides,
  }
}

function step(
  nodeId: string,
  status: RunStep["status"],
  extra: Partial<RunStep> = {}
): RunStep {
  return { nodeId, nodeType: "act", title: nodeId, status, ...extra }
}

describe("toWorkflowRun", () => {
  describe("isLive", () => {
    it.each([
      ["queued", { isQueued: true }],
      ["executing", { isExecuting: true }],
      ["waiting", { isWaiting: true }],
    ])("is live while the run is %s", (_, flags) => {
      expect(toWorkflowRun(run(flags)).isLive).toBe(true)
    })

    it("is not live once the run has settled", () => {
      expect(toWorkflowRun(run()).isLive).toBe(false)
      expect(toWorkflowRun(run({ isFailed: true })).isLive).toBe(false)
      expect(toWorkflowRun(run({ isCancelled: true })).isLive).toBe(false)
    })
  })

  describe("steps", () => {
    it("reads the live steps from metadata while the run is going", () => {
      const live = [step("a", "done"), step("b", "running")]

      const result = toWorkflowRun(
        run({ isExecuting: true, metadata: { steps: live } })
      )

      expect(result.steps).toEqual(live)
    })

    it("prefers the steps in the output once the run has finished", () => {
      const final = [step("a", "done"), step("b", "done")]
      const stale = [step("a", "done"), step("b", "running")]

      const result = toWorkflowRun(
        run({ output: { steps: final }, metadata: { steps: stale } })
      )

      expect(result.steps).toEqual(final)
    })

    it("has no steps before the first metadata write", () => {
      expect(toWorkflowRun(run({ isQueued: true })).steps).toEqual([])
    })
  })

  describe("browserbaseSessionId", () => {
    it("comes from the output of a finished run", () => {
      const result = toWorkflowRun(
        run({ output: { steps: [], browserbaseSessionId: "bb_123" } })
      )

      expect(result.browserbaseSessionId).toBe("bb_123")
    })

    // The recording only exists after the session closes, so an id read
    // mid-run would point the replay panel at something not there yet.
    it("is never read from metadata", () => {
      const result = toWorkflowRun(
        run({ isExecuting: true, metadata: { browserbaseSessionId: "bb_123" } })
      )

      expect(result.browserbaseSessionId).toBeUndefined()
    })
  })

  describe("a stopped run", () => {
    it("keeps the step it was stopped on as cancelled", () => {
      const steps = [
        step("start", "done", { nodeType: "start" }),
        step("a", "done"),
        step("b", "cancelled"),
        step("c", "pending"),
      ]

      const result = toWorkflowRun(
        run({ isCancelled: true, metadata: { steps } })
      )

      expect(result.steps).toEqual(steps)
    })

    // Runs from before steps could record a cancel: the interrupted step wrote
    // itself as failed, with the abort as its error.
    it("reads an interrupted step recorded as failed as cancelled, without its error", () => {
      const result = toWorkflowRun(
        run({
          isCancelled: true,
          metadata: {
            steps: [
              step("start", "done", { nodeType: "start" }),
              step("a", "done"),
              step("b", "failed", { error: "Run was aborted" }),
              step("c", "pending"),
            ],
          },
        })
      )

      expect(result.steps).toEqual([
        step("start", "done", { nodeType: "start" }),
        step("a", "done"),
        step("b", "cancelled", { error: undefined }),
        step("c", "pending"),
      ])
    })

    // The step's own cancel write can be lost like any other write.
    it("reads a step still running as cancelled", () => {
      const result = toWorkflowRun(
        run({
          isCancelled: true,
          metadata: { steps: [step("a", "done"), step("b", "running")] },
        })
      )

      expect(result.steps.map((s) => s.status)).toEqual(["done", "cancelled"])
    })

    it("does not get the failed-run repair painting a step red", () => {
      const steps = [step("a", "done"), step("b", "pending")]

      const result = toWorkflowRun(
        run({ isCancelled: true, metadata: { steps } })
      )

      expect(result.steps).toEqual(steps)
    })
  })

  describe("a failed run", () => {
    it("keeps a step that recorded its own failure as it is", () => {
      const steps = [
        step("a", "done"),
        step("b", "failed", { error: "Timed out" }),
        step("c", "pending"),
      ]

      const result = toWorkflowRun(run({ isFailed: true, metadata: { steps } }))

      expect(result.steps).toEqual(steps)
    })

    // The step's own "failed" write is the last thing a run does before
    // throwing, and a dropped flush or a killed worker can lose it.
    it("marks the first unfinished step failed when its failure write was lost", () => {
      const result = toWorkflowRun(
        run({
          isFailed: true,
          metadata: {
            steps: [
              step("start", "done", { nodeType: "start" }),
              step("a", "done"),
              step("b", "running"),
              step("c", "pending"),
            ],
          },
        })
      )

      expect(result.steps.map((s) => s.status)).toEqual([
        "done",
        "done",
        "failed",
        "pending",
      ])
    })

    it("never blames a skipped step, since it never executes", () => {
      const result = toWorkflowRun(
        run({
          isFailed: true,
          metadata: {
            steps: [
              step("start", "skipped", { nodeType: "start" }),
              step("a", "pending"),
            ],
          },
        })
      )

      expect(result.steps.map((s) => s.status)).toEqual(["skipped", "failed"])
    })

    // The console falls back to the run's own error for a repaired step.
    it("does not invent an error message for a repaired step", () => {
      const result = toWorkflowRun(
        run({ isFailed: true, metadata: { steps: [step("a", "running")] } })
      )

      expect(result.steps[0].error).toBeUndefined()
    })

    // A run can fail after its last step, while closing the browser session.
    it("leaves the steps alone when every step finished", () => {
      const steps = [step("a", "done"), step("b", "done")]

      const result = toWorkflowRun(run({ isFailed: true, metadata: { steps } }))

      expect(result.steps).toEqual(steps)
    })
  })

  // The steps come straight from the realtime store. Writing into them would
  // change what every other reader of that run sees.
  it("never mutates the steps it was given", () => {
    const cancelled = [step("a", "failed", { error: "aborted" })]
    const failed = [step("a", "running")]

    toWorkflowRun(run({ isCancelled: true, metadata: { steps: cancelled } }))
    toWorkflowRun(run({ isFailed: true, metadata: { steps: failed } }))

    expect(cancelled).toEqual([step("a", "failed", { error: "aborted" })])
    expect(failed).toEqual([step("a", "running")])
  })
})
