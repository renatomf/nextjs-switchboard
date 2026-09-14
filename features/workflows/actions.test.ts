import { beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkflowGraph } from "@/lib/db/schema"
import { cancelWorkflowRunAction, runWorkflowAction } from "./actions"

// The actions sit between three outside systems: Clerk says who is asking,
// Postgres whose workflow it is, Trigger.dev whose run it is. Each is faked at
// its module boundary so the logic in between runs for real.
const {
  auth,
  getWorkflow,
  publishWorkflowVersion,
  recordExecution,
  advanceExecution,
  retrieveRun,
  cancelRun,
  triggerTask,
} = vi.hoisted(() => ({
  auth: vi.fn(),
  getWorkflow: vi.fn(),
  publishWorkflowVersion: vi.fn(),
  recordExecution: vi.fn(),
  advanceExecution: vi.fn(),
  retrieveRun: vi.fn(),
  cancelRun: vi.fn(),
  triggerTask: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth }))
vi.mock("@trigger.dev/sdk", () => ({
  runs: { retrieve: retrieveRun, cancel: cancelRun },
  tasks: { trigger: triggerTask },
}))
vi.mock("@/features/workflows/data", () => ({
  getWorkflow,
  publishWorkflowVersion,
  recordExecution,
  advanceExecution,
  createWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
}))
vi.mock("@sentry/nextjs", () => ({
  getIsolationScope: () => ({ setAttributes: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

describe("runWorkflowAction", () => {
  // What the canvas sends. The version it becomes is faked, so its contents
  // do not matter here.
  const graph: WorkflowGraph = { nodes: [], edges: [] }

  beforeEach(() => {
    auth.mockResolvedValue({ orgId: "org_a", has: () => true })
    triggerTask.mockResolvedValue({ id: "run_1" })
    recordExecution.mockResolvedValue(undefined)
  })

  it("publishes the graph as a version and runs exactly that version", async () => {
    publishWorkflowVersion.mockResolvedValue({ id: "ver_1" })

    await runWorkflowAction({ id: "wf_1", graph })

    expect(publishWorkflowVersion).toHaveBeenCalledWith({
      orgId: "org_a",
      workflowId: "wf_1",
      graph,
    })
    expect(triggerTask).toHaveBeenCalledWith(
      "run-workflow",
      { workflowId: "wf_1", orgId: "org_a", versionId: "ver_1" },
      { tags: ["workflow:wf_1"] }
    )
  })

  it("records the execution under the run it started", async () => {
    publishWorkflowVersion.mockResolvedValue({ id: "ver_1" })

    await runWorkflowAction({ id: "wf_1", graph })

    expect(recordExecution).toHaveBeenCalledWith({
      runId: "run_1",
      orgId: "org_a",
      workflowId: "wf_1",
      versionId: "ver_1",
    })
  })

  // The run is already in Trigger.dev by then, and the worker writes the row
  // itself when it starts. Failing the Run button here would only hide a run
  // that is going ahead anyway.
  it("still returns the run when recording its execution fails", async () => {
    publishWorkflowVersion.mockResolvedValue({ id: "ver_1" })
    recordExecution.mockRejectedValue(new Error("connection reset"))

    await expect(runWorkflowAction({ id: "wf_1", graph })).resolves.toEqual({
      id: "run_1",
    })
  })

  // The race this closes: a run used to read the workflow's latest graph when
  // the worker got to it, so a second Run could swap the graph under a first
  // one still waiting in the queue.
  it("gives two runs in a row a version each", async () => {
    publishWorkflowVersion
      .mockResolvedValueOnce({ id: "ver_1" })
      .mockResolvedValueOnce({ id: "ver_2" })

    await runWorkflowAction({ id: "wf_1", graph })
    await runWorkflowAction({ id: "wf_1", graph })

    const versions = triggerTask.mock.calls.map(
      ([, payload]) => payload.versionId
    )
    expect(versions).toEqual(["ver_1", "ver_2"])
  })

  it("starts no run when the version cannot be published", async () => {
    publishWorkflowVersion.mockRejectedValue(new Error("Workflow not found"))

    await expect(runWorkflowAction({ id: "wf_other", graph })).rejects.toThrow(
      "Workflow not found"
    )
    expect(triggerTask).not.toHaveBeenCalled()
    expect(recordExecution).not.toHaveBeenCalled()
  })
})

describe("cancelWorkflowRunAction", () => {
  // Org A is signed in and owns wf_1, whose run is run_1.
  beforeEach(() => {
    auth.mockResolvedValue({ orgId: "org_a" })
    getWorkflow.mockResolvedValue({ id: "wf_1", orgId: "org_a" })
    retrieveRun.mockResolvedValue({
      taskIdentifier: "run-workflow",
      tags: ["workflow:wf_1"],
    })
    cancelRun.mockResolvedValue({ id: "run_1" })
    advanceExecution.mockResolvedValue(undefined)
  })

  it("cancels a run of the caller's own workflow", async () => {
    await cancelWorkflowRunAction({ workflowId: "wf_1", runId: "run_1" })

    expect(getWorkflow).toHaveBeenCalledWith("org_a", "wf_1")
    expect(cancelRun).toHaveBeenCalledWith("run_1")
  })

  // The worker's onCancel hook only fires for a run it is executing. A run
  // stopped while still queued would stay "queued" forever without this.
  it("records the cancellation on the execution", async () => {
    await cancelWorkflowRunAction({ workflowId: "wf_1", runId: "run_1" })

    expect(advanceExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run_1",
        orgId: "org_a",
        workflowId: "wf_1",
        event: "cancelled",
      })
    )
  })

  it("still stops the run when recording the cancellation fails", async () => {
    advanceExecution.mockRejectedValue(new Error("connection reset"))

    await expect(
      cancelWorkflowRunAction({ workflowId: "wf_1", runId: "run_1" })
    ).resolves.toBeUndefined()
    expect(cancelRun).toHaveBeenCalledWith("run_1")
  })

  it("requires an active organization", async () => {
    auth.mockResolvedValue({ orgId: null })

    await expect(
      cancelWorkflowRunAction({ workflowId: "wf_1", runId: "run_1" })
    ).rejects.toThrow("No active organization")
    expect(cancelRun).not.toHaveBeenCalled()
  })

  // Every org's runs live in one Trigger.dev project, so a run id alone
  // proves nothing about who may stop it.
  describe("refuses a run the caller does not own", () => {
    it("when the workflow belongs to another org, without looking up the run", async () => {
      getWorkflow.mockResolvedValue(undefined)

      await expect(
        cancelWorkflowRunAction({ workflowId: "wf_other", runId: "run_9" })
      ).rejects.toThrow("Run not found")
      expect(retrieveRun).not.toHaveBeenCalled()
      expect(cancelRun).not.toHaveBeenCalled()
      expect(advanceExecution).not.toHaveBeenCalled()
    })

    it("when the run belongs to another workflow", async () => {
      retrieveRun.mockResolvedValue({
        taskIdentifier: "run-workflow",
        tags: ["workflow:wf_other"],
      })

      await expect(
        cancelWorkflowRunAction({ workflowId: "wf_1", runId: "run_9" })
      ).rejects.toThrow("Run not found")
      expect(cancelRun).not.toHaveBeenCalled()
      expect(advanceExecution).not.toHaveBeenCalled()
    })

    it("when the run is of another task", async () => {
      retrieveRun.mockResolvedValue({
        taskIdentifier: "send-report",
        tags: ["workflow:wf_1"],
      })

      await expect(
        cancelWorkflowRunAction({ workflowId: "wf_1", runId: "run_9" })
      ).rejects.toThrow("Run not found")
      expect(cancelRun).not.toHaveBeenCalled()
      expect(advanceExecution).not.toHaveBeenCalled()
    })
  })
})
