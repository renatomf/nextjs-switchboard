import { describe, expect, it } from "vitest"

import { isRunOfWorkflow, workflowRunTag } from "./run-ownership"

describe("workflowRunTag", () => {
  it("namespaces the workflow id", () => {
    expect(workflowRunTag("wf_1")).toBe("workflow:wf_1")
  })
})

describe("isRunOfWorkflow", () => {
  it("accepts a run of the workflow task tagged with that workflow", () => {
    const run = { taskIdentifier: "run-workflow", tags: ["workflow:wf_1"] }

    expect(isRunOfWorkflow(run, "wf_1")).toBe(true)
  })

  it("finds the workflow tag among other tags", () => {
    const run = {
      taskIdentifier: "run-workflow",
      tags: ["env:prod", "workflow:wf_1"],
    }

    expect(isRunOfWorkflow(run, "wf_1")).toBe(true)
  })

  it("rejects a run tagged with another workflow", () => {
    const run = { taskIdentifier: "run-workflow", tags: ["workflow:wf_2"] }

    expect(isRunOfWorkflow(run, "wf_1")).toBe(false)
  })

  it("rejects a run of another task, even with the right tag", () => {
    const run = { taskIdentifier: "send-report", tags: ["workflow:wf_1"] }

    expect(isRunOfWorkflow(run, "wf_1")).toBe(false)
  })

  it("rejects a run with no tags", () => {
    const run = { taskIdentifier: "run-workflow", tags: [] }

    expect(isRunOfWorkflow(run, "wf_1")).toBe(false)
  })

  // Tags are compared whole. A workflow whose id merely starts the same way
  // must not pass for this one.
  it("does not match on a prefix of the workflow id", () => {
    const run = { taskIdentifier: "run-workflow", tags: ["workflow:wf_10"] }

    expect(isRunOfWorkflow(run, "wf_1")).toBe(false)
  })
})
