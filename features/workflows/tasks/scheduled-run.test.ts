import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { runScheduledWorkflow } from "./scheduled-run"

const {
  getScheduleForRun,
  deactivateWorkflowSchedule,
  getLatestWorkflowVersion,
  startWorkflowRun,
  fetchOrgIsPro,
  deleteSchedule,
  deactivateSchedule,
} = vi.hoisted(() => ({
  getScheduleForRun: vi.fn(),
  deactivateWorkflowSchedule: vi.fn(),
  getLatestWorkflowVersion: vi.fn(),
  startWorkflowRun: vi.fn(),
  fetchOrgIsPro: vi.fn(),
  deleteSchedule: vi.fn(),
  deactivateSchedule: vi.fn(),
}))

vi.mock("@/features/workflows/data", () => ({
  getScheduleForRun,
  deactivateWorkflowSchedule,
  getLatestWorkflowVersion,
}))
vi.mock("@/features/workflows/start-run", () => ({ startWorkflowRun }))
vi.mock("@/lib/org-plan", () => ({ fetchOrgIsPro }))
vi.mock("@trigger.dev/sdk", () => ({
  schedules: { del: deleteSchedule, deactivate: deactivateSchedule },
}))

const run = () => runScheduledWorkflow({ scheduleId: "sched_1" })

describe("runScheduledWorkflow", () => {
  // sched_1 is org A's schedule of wf_1, whose newest version is ver_3, and
  // org A is on Pro.
  beforeEach(() => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_1")
    getScheduleForRun.mockResolvedValue({
      workflowId: "wf_1",
      orgId: "org_a",
      triggerScheduleId: "sched_1",
      active: true,
    })
    fetchOrgIsPro.mockResolvedValue(true)
    getLatestWorkflowVersion.mockResolvedValue({ id: "ver_3" })
    startWorkflowRun.mockResolvedValue({
      alreadyGoing: false,
      runId: "run_1",
      versionId: "ver_3",
      queue: "runs-pro",
    })
    deleteSchedule.mockResolvedValue({ id: "sched_1" })
    deactivateSchedule.mockResolvedValue({ id: "sched_1", active: false })
    deactivateWorkflowSchedule.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("starts a run of the workflow's newest version", async () => {
    await expect(run()).resolves.toEqual({
      outcome: "started",
      runId: "run_1",
    })

    expect(getScheduleForRun).toHaveBeenCalledWith("sched_1")
    expect(getLatestWorkflowVersion).toHaveBeenCalledWith("org_a", "wf_1")
    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_a",
        workflowId: "wf_1",
        isPro: true,
        tags: ["scheduled"],
      })
    )
    const [{ version }] = startWorkflowRun.mock.calls[0]
    await expect(version()).resolves.toEqual({ id: "ver_3" })
  })

  // A scheduled run has no Clerk session to ask has() of.
  it("asks Clerk about the schedule's org", async () => {
    await run()

    expect(fetchOrgIsPro).toHaveBeenCalledWith("org_a", {
      secretKey: "sk_test_1",
    })
  })

  // One run per workflow holds for schedules too: a run still going from
  // the last time, or from a person, is left to finish.
  it("leaves a run already going alone", async () => {
    startWorkflowRun.mockResolvedValue({
      alreadyGoing: true,
      runId: "run_live",
    })

    await expect(run()).resolves.toEqual({
      outcome: "already-going",
      runId: "run_live",
    })
  })

  it("turns the schedule off once the org is no longer on Pro", async () => {
    fetchOrgIsPro.mockResolvedValue(false)

    await expect(run()).resolves.toEqual({ outcome: "plan-required" })

    expect(deactivateSchedule).toHaveBeenCalledWith("sched_1")
    expect(deactivateWorkflowSchedule).toHaveBeenCalledWith("sched_1")
    expect(startWorkflowRun).not.toHaveBeenCalled()
  })

  // A hiccup on Clerk's side must not turn a paying org's schedule off: the
  // run fails, and the next one asks again.
  it("fails without turning anything off when Clerk cannot answer", async () => {
    fetchOrgIsPro.mockRejectedValue(
      new Error("Clerk answered 503 for the org's subscription")
    )

    await expect(run()).rejects.toThrow("Clerk answered 503")

    expect(deactivateSchedule).not.toHaveBeenCalled()
    expect(deactivateWorkflowSchedule).not.toHaveBeenCalled()
    expect(startWorkflowRun).not.toHaveBeenCalled()
  })

  // A schedule on Trigger.dev the app has no record of, left behind when
  // saving its record failed: removed, so it stops running.
  it("removes a schedule the app has no record of", async () => {
    getScheduleForRun.mockResolvedValue(undefined)

    await expect(run()).resolves.toEqual({ outcome: "no-record" })

    expect(deleteSchedule).toHaveBeenCalledWith("sched_1")
    expect(fetchOrgIsPro).not.toHaveBeenCalled()
    expect(startWorkflowRun).not.toHaveBeenCalled()
  })

  it("does nothing for a schedule already turned off", async () => {
    getScheduleForRun.mockResolvedValue({
      workflowId: "wf_1",
      orgId: "org_a",
      triggerScheduleId: "sched_1",
      active: false,
    })

    await expect(run()).resolves.toEqual({ outcome: "inactive" })

    expect(fetchOrgIsPro).not.toHaveBeenCalled()
    expect(startWorkflowRun).not.toHaveBeenCalled()
  })

  it("starts nothing for a workflow with no version to run", async () => {
    getLatestWorkflowVersion.mockResolvedValue(undefined)

    await expect(run()).resolves.toEqual({ outcome: "no-version" })

    expect(startWorkflowRun).not.toHaveBeenCalled()
  })
})
