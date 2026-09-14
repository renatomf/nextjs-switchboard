import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadRunGraph } from "./load-run-graph"

const { getWorkflow, getWorkflowVersion } = vi.hoisted(() => ({
  getWorkflow: vi.fn(),
  getWorkflowVersion: vi.fn(),
}))

vi.mock("@/features/workflows/data", () => ({
  getWorkflow,
  getWorkflowVersion,
}))

// Two different graphs, so a test can tell which one the run got.
const versionGraph = {
  nodes: [],
  edges: [{ id: "e1", source: "start", target: "a" }],
}
const latestGraph = { nodes: [], edges: [] }

describe("loadRunGraph", () => {
  beforeEach(() => {
    getWorkflowVersion.mockResolvedValue({ id: "ver_1", graph: versionGraph })
    getWorkflow.mockResolvedValue({ id: "wf_1", graph: latestGraph })
  })

  it("runs the version the run was started with, not the latest graph", async () => {
    const graph = await loadRunGraph({
      workflowId: "wf_1",
      orgId: "org_a",
      versionId: "ver_1",
    })

    expect(graph).toBe(versionGraph)
    expect(getWorkflowVersion).toHaveBeenCalledWith("org_a", "ver_1")
    expect(getWorkflow).not.toHaveBeenCalled()
  })

  // Falling back to the workflow's latest graph here would bring the race
  // back, and silently: the run would execute someone else's edit.
  it("fails instead of falling back when the version is missing", async () => {
    getWorkflowVersion.mockResolvedValue(undefined)

    await expect(
      loadRunGraph({ workflowId: "wf_1", orgId: "org_a", versionId: "ver_x" })
    ).rejects.toThrow("Workflow version ver_x not found")
    expect(getWorkflow).not.toHaveBeenCalled()
  })

  // The web app and the worker deploy separately, so for a while the worker
  // can receive a run triggered by an app that predates versions.
  it("reads the latest graph for a run started before versions existed", async () => {
    const graph = await loadRunGraph({ workflowId: "wf_1", orgId: "org_a" })

    expect(graph).toBe(latestGraph)
    expect(getWorkflow).toHaveBeenCalledWith("org_a", "wf_1")
  })

  it("fails when such a workflow has no graph", async () => {
    getWorkflow.mockResolvedValue({ id: "wf_1", graph: null })

    await expect(
      loadRunGraph({ workflowId: "wf_1", orgId: "org_a" })
    ).rejects.toThrow("Workflow wf_1 has no graph")
  })
})
