import { beforeEach, describe, expect, it, vi } from "vitest"

import { cancelWorkflowRunAction } from "./actions"

// The action sits between three outside systems: Clerk says who is asking,
// Postgres whose workflow it is, Trigger.dev whose run it is. Each is faked at
// its module boundary so the ownership logic in between runs for real.
const { auth, getWorkflow, retrieveRun, cancelRun } = vi.hoisted(() => ({
  auth: vi.fn(),
  getWorkflow: vi.fn(),
  retrieveRun: vi.fn(),
  cancelRun: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth }))
vi.mock("@trigger.dev/sdk", () => ({
  runs: { retrieve: retrieveRun, cancel: cancelRun },
  tasks: { trigger: vi.fn() },
}))
vi.mock("@/features/workflows/data", () => ({
  getWorkflow,
  createWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  saveWorkflowGraph: vi.fn(),
}))
vi.mock("@sentry/nextjs", () => ({
  getIsolationScope: () => ({ setAttributes: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

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
  })

  it("cancels a run of the caller's own workflow", async () => {
    await cancelWorkflowRunAction({ workflowId: "wf_1", runId: "run_1" })

    expect(getWorkflow).toHaveBeenCalledWith("org_a", "wf_1")
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
    })
  })
})
