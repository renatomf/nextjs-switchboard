import type { Stagehand } from "@browserbasehq/stagehand"
import type { Edge } from "@xyflow/react"
import { describe, expect, it, vi } from "vitest"

import type { NodeExecutor } from "@/features/workflows/nodes/node-executors"
import type {
  NodeType,
  StepNodeType,
} from "@/features/workflows/nodes/node-registry"
import { StepTimeoutError } from "@/features/workflows/lib/step-errors"
import type { WorkflowGraph } from "@/lib/db/schema"
import { runSteps, type RunStep, type StepPolicy } from "./run-steps"

function node(
  id: string,
  type: NodeType = "act",
  values: Record<string, string> = {}
): StepNodeType {
  return {
    id,
    type: "step",
    position: { x: 0, y: 0 },
    data: {
      type,
      kind: type === "start" ? "trigger" : "action",
      title: id,
      values,
    },
  }
}

function edge(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target }
}

// Start -> a -> b, with both steps as acts.
const chain: WorkflowGraph = {
  nodes: [
    node("start", "start"),
    node("a", "act", { instruction: "a" }),
    node("b", "act", { instruction: "b" }),
  ],
  edges: [edge("start", "a"), edge("a", "b")],
}

// What an act gets unless a test says otherwise: one attempt, and time enough
// that no test runs out of it by accident.
const oneAttempt: StepPolicy = {
  timeoutMs: 1_000,
  maxAttempts: 1,
  retryDelayMs: 0,
}

// An error of the kind worth trying again: a connection that dropped.
const connectionReset = () =>
  Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })

// A run wired to fakes: the executor for acts, a browser that records whether
// it was opened and released, and a reporter that keeps every publish so a
// test can read what the run showed at each point.
function setup({
  graph = chain,
  act,
  policy = oneAttempt,
  signal = new AbortController().signal,
}: {
  graph?: WorkflowGraph
  act: NodeExecutor
  policy?: StepPolicy
  signal?: AbortSignal
}) {
  const published: RunStep[][] = []
  const progress = {
    publish: vi.fn((steps: RunStep[]) => {
      published.push(steps)
    }),
    flush: vi.fn(async () => {}),
    flushReliably: vi.fn(async () => {}),
  }
  const browser = {
    get: vi.fn(async () => ({ fake: "browser" }) as unknown as Stagehand),
    release: vi.fn(async () => {}),
  }
  const logger = { log: vi.fn(), warn: vi.fn() }

  const run = () =>
    runSteps({
      runId: "run_1",
      graph,
      executors: { act },
      policies: { act: policy },
      browser,
      progress,
      logger,
      signal,
    })

  return { run, published, progress, browser, logger }
}

const lastPublished = (published: RunStep[][]) => published.at(-1) ?? []
const statuses = (steps: RunStep[]) =>
  steps.map((step) => `${step.nodeId}:${step.status}`)

describe("runSteps", () => {
  describe("the walk", () => {
    it("runs the connected steps in dependency order, and only those", async () => {
      const ran: string[] = []
      const { run } = setup({
        // Listed out of order, with a step loose on the canvas.
        graph: {
          nodes: [
            node("b", "act", { instruction: "b" }),
            node("loose", "act", { instruction: "loose" }),
            node("start", "start"),
            node("a", "act", { instruction: "a" }),
          ],
          edges: [edge("start", "a"), edge("a", "b")],
        },
        act: async ({ values }) => {
          ran.push(values.instruction)
        },
      })

      await run()

      expect(ran).toEqual(["a", "b"])
    })

    it("publishes the whole plan before the first step runs", async () => {
      const { run, published } = setup({ act: async () => "ok" })

      await run()

      expect(statuses(published[0])).toEqual([
        "start:skipped",
        "a:pending",
        "b:pending",
      ])
    })

    // The trigger is where the flow starts, not work the run does.
    it("passes the trigger without executing it", async () => {
      const { run } = setup({ act: async () => "ok" })

      const { steps } = await run()

      expect(statuses(steps)).toEqual(["start:done", "a:done", "b:done"])
    })

    // Metadata is flushed on a timer, so without a push here the step's
    // running state would be overwritten in memory before it ever showed.
    it("pushes a step's running state out before executing it", async () => {
      let seen: string[] = []
      const { run, published, progress } = setup({
        act: async ({ values }) => {
          if (values.instruction === "a") {
            seen = statuses(lastPublished(published))
            expect(progress.flush).toHaveBeenCalled()
          }
        },
      })

      await run()

      expect(seen).toEqual(["start:done", "a:running", "b:pending"])
    })
  })

  describe("outputs", () => {
    it("hands a step its values with placeholders resolved from earlier outputs", async () => {
      const received: string[] = []
      const { run } = setup({
        graph: {
          nodes: [
            node("start", "start"),
            node("a", "act", { instruction: "Read the title" }),
            node("b", "act", { instruction: "Search for {{ a.title }}" }),
          ],
          edges: [edge("start", "a"), edge("a", "b")],
        },
        act: async ({ values }) => {
          received.push(values.instruction)
          return { title: "Laptops" }
        },
      })

      await run()

      expect(received).toEqual(["Read the title", "Search for Laptops"])
    })

    it("records each step's output and duration, and returns every output", async () => {
      const { run } = setup({
        act: async ({ values }) => ({ from: values.instruction }),
      })

      const { steps, outputs } = await run()

      expect(steps[1]).toMatchObject({
        status: "done",
        output: { from: "a" },
        durationMs: expect.any(Number),
      })
      expect(outputs).toEqual({ a: { from: "a" }, b: { from: "b" } })
    })

    // Steps ride in run metadata, which has a size cap the SDK enforces by
    // throwing. The full value still goes to later steps and the outputs.
    it("clamps a long output on the step but keeps it whole in the outputs", async () => {
      const long = "x".repeat(5_000)
      const { run } = setup({ act: async () => long })

      const { steps, outputs } = await run()

      expect(String(steps[1].output)).toMatch(/… \(truncated\)$/)
      expect(String(steps[1].output).length).toBeLessThan(long.length)
      expect(outputs.a).toBe(long)
    })
  })

  describe("the browser", () => {
    it("only opens the browser for a step that asks for it", async () => {
      const { run, browser } = setup({ act: async () => "no browser needed" })

      await run()

      expect(browser.get).not.toHaveBeenCalled()
    })

    it("hands a step the run's browser", async () => {
      let handed: unknown
      const { run, browser } = setup({
        act: async ({ getStagehand }) => {
          handed = await getStagehand()
        },
      })

      await run()

      expect(handed).toEqual({ fake: "browser" })
      expect(browser.get).toHaveBeenCalled()
    })

    it("releases the browser once the run is over", async () => {
      const { run, browser } = setup({ act: async () => "ok" })

      await run()

      expect(browser.release).toHaveBeenCalledTimes(1)
    })
  })

  describe("a failing step", () => {
    it("is recorded as failed with its message, and the run stops there", async () => {
      const { run, published, progress, browser } = setup({
        act: async ({ values }) => {
          if (values.instruction === "a") throw new Error("Timed out")
        },
      })

      await expect(run()).rejects.toThrow("Timed out")

      const steps = lastPublished(published)
      expect(statuses(steps)).toEqual(["start:done", "a:failed", "b:pending"])
      expect(steps[1].error).toBe("Timed out")
      // A thrown run returns no output: this push is the only way the failure
      // reaches the canvas.
      expect(progress.flushReliably).toHaveBeenCalled()
      expect(browser.release).toHaveBeenCalledTimes(1)
    })

    it("keeps the message of a throw that is not an Error", async () => {
      const { run, published } = setup({
        act: async () => {
          throw "quota exceeded"
        },
      })

      await expect(run()).rejects.toBe("quota exceeded")

      expect(lastPublished(published)[1].error).toBe("quota exceeded")
    })
  })

  // A step that fails for a reason worth trying again gets another go in the
  // same browser, on the page the steps before it left, instead of the whole
  // run starting over in a new session.
  describe("trying a step again", () => {
    const retrying: StepPolicy = {
      timeoutMs: 1_000,
      maxAttempts: 3,
      retryDelayMs: 0,
    }

    it("tries again after an error worth it, in the same browser", async () => {
      let calls = 0
      const { run, browser } = setup({
        policy: retrying,
        act: async ({ values, getStagehand }) => {
          await getStagehand()
          if (values.instruction === "a" && ++calls === 1) {
            throw connectionReset()
          }
          return "ok"
        },
      })

      const { steps } = await run()

      expect(calls).toBe(2)
      expect(statuses(steps)).toEqual(["start:done", "a:done", "b:done"])
      expect(steps[1].attempts).toBe(2)
      expect(browser.release).toHaveBeenCalledTimes(1)
    })

    // A browser that keeps failing: every attempt but the last drops the
    // connection, and the step still gets there within its attempts.
    it("gets there on its last attempt after every other one failed", async () => {
      const failuresBeforeSuccess = retrying.maxAttempts - 1
      let calls = 0
      const { run, browser } = setup({
        policy: retrying,
        act: async ({ values, getStagehand }) => {
          await getStagehand()
          if (values.instruction !== "a") return "ok"
          if (++calls <= failuresBeforeSuccess) throw connectionReset()
          return "ok"
        },
      })

      const { steps } = await run()

      expect(calls).toBe(retrying.maxAttempts)
      expect(steps[1]).toMatchObject({ status: "done", attempts: 3 })
      expect(browser.release).toHaveBeenCalledTimes(1)
    })

    it("stays running while it tries again, and says which attempt it is on", async () => {
      let seen: RunStep | undefined
      let calls = 0
      const { run, published } = setup({
        policy: retrying,
        act: async ({ values }) => {
          if (values.instruction !== "a") return
          calls += 1
          if (calls === 1) throw connectionReset()
          seen = lastPublished(published)[1]
        },
      })

      await run()

      expect(seen).toMatchObject({ status: "running", attempts: 2 })
    })

    it("does not try again an error that a retry would not fix", async () => {
      const act = vi.fn(async () => {
        throw new Error("Something broke")
      })
      const { run, published } = setup({ policy: retrying, act })

      await expect(run()).rejects.toThrow("Something broke")

      expect(act).toHaveBeenCalledTimes(1)
      expect(lastPublished(published)[1].status).toBe("failed")
    })

    it("gives up after the step's last attempt, with that attempt's error", async () => {
      const act = vi.fn(async () => {
        throw connectionReset()
      })
      const { run, published } = setup({
        policy: { ...retrying, maxAttempts: 2 },
        act,
      })

      await expect(run()).rejects.toThrow("read ECONNRESET")

      expect(act).toHaveBeenCalledTimes(2)
      expect(lastPublished(published)[1]).toMatchObject({
        status: "failed",
        error: "read ECONNRESET",
        attempts: 2,
      })
    })

    // A step that sends an email must not send it twice, so every attempt of
    // a step carries the same key for the service to recognise it by.
    it("hands every attempt of a step the same idempotency key", async () => {
      const keys: string[] = []
      let calls = 0
      const { run } = setup({
        policy: retrying,
        act: async ({ values, idempotencyKey }) => {
          if (values.instruction !== "a") return
          keys.push(idempotencyKey)
          if (++calls === 1) throw connectionReset()
        },
      })

      await run()

      expect(keys).toEqual(["run_1:a", "run_1:a"])
    })

    it("stops waiting to try again when the run is stopped", async () => {
      const controller = new AbortController()
      const act = vi.fn(async () => {
        setTimeout(() => controller.abort(), 10)
        throw connectionReset()
      })
      const { run, published } = setup({
        policy: { ...retrying, retryDelayMs: 5_000 },
        signal: controller.signal,
        act,
      })

      await expect(run()).rejects.toThrow()

      expect(act).toHaveBeenCalledTimes(1)
      const step = lastPublished(published)[1]
      expect(step.status).toBe("cancelled")
      expect(step.error).toBeUndefined()
    })
  })

  describe("a step that runs out of time", () => {
    it("fails with the time it was given, and is not tried again", async () => {
      const act = vi.fn(() => new Promise<never>(() => {}))
      const { run, published, browser } = setup({
        policy: { timeoutMs: 20, maxAttempts: 3, retryDelayMs: 0 },
        act,
      })

      await expect(run()).rejects.toBeInstanceOf(StepTimeoutError)

      expect(act).toHaveBeenCalledTimes(1)
      expect(lastPublished(published)[1]).toMatchObject({
        status: "failed",
        error: "The step took longer than 0.02 s and was stopped",
      })
      // Closing the browser is what stops the attempt still driving it.
      expect(browser.release).toHaveBeenCalledTimes(1)
    })
  })

  describe("a Stop", () => {
    it("records the step it lands on as cancelled, with no error", async () => {
      const controller = new AbortController()
      const { run, published, browser } = setup({
        signal: controller.signal,
        act: async () => {
          // What a Stop does to a step in flight: the browser is closed under
          // it, and it throws.
          controller.abort()
          throw new Error("The run was cancelled")
        },
      })

      await expect(run()).rejects.toThrow()

      const steps = lastPublished(published)
      expect(statuses(steps)).toEqual([
        "start:done",
        "a:cancelled",
        "b:pending",
      ])
      expect(steps[1].error).toBeUndefined()
      expect(browser.release).toHaveBeenCalledTimes(1)
    })

    // The case too narrow to hit by hand: the Stop lands after one step has
    // finished and before the next begins. The next step, which could be one
    // that sends an email, must not start.
    it("between two steps, starts nothing more", async () => {
      const controller = new AbortController()
      const ran: string[] = []
      const { run, published } = setup({
        signal: controller.signal,
        act: async ({ values }) => {
          ran.push(values.instruction)
          if (values.instruction === "a") controller.abort()
        },
      })

      await expect(run()).rejects.toThrow()

      expect(ran).toEqual(["a"])
      expect(statuses(lastPublished(published))).toEqual([
        "start:done",
        "a:done",
        "b:pending",
      ])
    })
  })
})
