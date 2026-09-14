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
  listRuns,
  triggerTask,
} = vi.hoisted(() => ({
  auth: vi.fn(),
  getWorkflow: vi.fn(),
  publishWorkflowVersion: vi.fn(),
  recordExecution: vi.fn(),
  advanceExecution: vi.fn(),
  retrieveRun: vi.fn(),
  cancelRun: vi.fn(),
  listRuns: vi.fn(),
  triggerTask: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth }))
vi.mock("@trigger.dev/sdk", () => ({
  runs: { retrieve: retrieveRun, cancel: cancelRun, list: listRuns },
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

  // Org A owns wf_1, which has no run going.
  beforeEach(() => {
    auth.mockResolvedValue({ orgId: "org_a", has: () => true })
    getWorkflow.mockResolvedValue({ id: "wf_1", orgId: "org_a" })
    listRuns.mockResolvedValue({ data: [] })
    triggerTask.mockResolvedValue({ id: "run_1" })
    recordExecution.mockResolvedValue(undefined)
  })

  // The canvas assumes a workflow has at most one run going: its Run button
  // turns into Stop, and Stop reaches a single run. Two tabs, or two people on
  // the shared canvas, used to start a second one anyway.
  describe("one run going per workflow", () => {
    it("hands back the run already going instead of starting another", async () => {
      listRuns.mockResolvedValue({ data: [{ id: "run_live" }] })

      await expect(runWorkflowAction({ id: "wf_1", graph })).resolves.toEqual({
        id: "run_live",
      })
      expect(publishWorkflowVersion).not.toHaveBeenCalled()
      expect(triggerTask).not.toHaveBeenCalled()
      expect(recordExecution).not.toHaveBeenCalled()
    })

    it("only counts this workflow's runs that are still going", async () => {
      publishWorkflowVersion.mockResolvedValue({ id: "ver_1" })

      await runWorkflowAction({ id: "wf_1", graph })

      expect(listRuns).toHaveBeenCalledWith(
        expect.objectContaining({
          tag: "workflow:wf_1",
          taskIdentifier: "run-workflow",
          status: expect.arrayContaining(["QUEUED", "EXECUTING", "WAITING"]),
        })
      )
      expect(listRuns.mock.calls[0][0].status).not.toContain("COMPLETED")
    })

    // Looking the runs up first would tell a caller holding another org's
    // workflow id whether that workflow is running, and hand over its run id.
    it("refuses another org's workflow before looking at its runs", async () => {
      getWorkflow.mockResolvedValue(undefined)

      await expect(
        runWorkflowAction({ id: "wf_other", graph })
      ).rejects.toThrow("Workflow not found")
      expect(getWorkflow).toHaveBeenCalledWith("org_a", "wf_other")
      expect(listRuns).not.toHaveBeenCalled()
      expect(publishWorkflowVersion).not.toHaveBeenCalled()
      expect(triggerTask).not.toHaveBeenCalled()
    })
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
      { tags: ["workflow:wf_1"], queue: "runs-pro", concurrencyKey: "org_a" }
    )
  })

  // Every org gets its own copy of its plan's queue: one org's runs cannot
  // take every slot, and a free org runs one workflow at a time.
  it("runs a free org's workflow on the free queue, keyed by the org", async () => {
    auth.mockResolvedValue({ orgId: "org_a", has: () => false })
    publishWorkflowVersion.mockResolvedValue({ id: "ver_1" })

    await runWorkflowAction({ id: "wf_1", graph })

    expect(triggerTask).toHaveBeenCalledWith(
      "run-workflow",
      expect.anything(),
      expect.objectContaining({ queue: "runs-free", concurrencyKey: "org_a" })
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
