import * as Sentry from "@sentry/node"
import { schedules } from "@trigger.dev/sdk"

import {
  deactivateWorkflowSchedule,
  getLatestWorkflowVersion,
  getScheduleForRun,
} from "@/features/workflows/data"
import { startWorkflowRun } from "@/features/workflows/start-run"
import { fetchOrgIsPro } from "@/lib/org-plan"

// Tagged on every run a schedule starts, next to the workflow's own tag, so a
// scheduled run can be told apart from one a person started.
const SCHEDULED_RUN_TAG = "scheduled"

type ScheduledRunOutcome =
  | { outcome: "started"; runId: string }
  | { outcome: "already-going"; runId: string }
  | { outcome: "over-quota" }
  | { outcome: "plan-required" }
  | { outcome: "no-record" }
  | { outcome: "inactive" }
  | { outcome: "no-version" }

// What a schedule does when Trigger.dev fires it: starts a run of its workflow
// the same way the Run button does, after the checks a person would have met on
// the way there.
export async function runScheduledWorkflow({
  scheduleId,
}: {
  // The id Trigger.dev hands the run: which schedule fired.
  scheduleId: string
}): Promise<ScheduledRunOutcome> {
  const schedule = await getScheduleForRun(scheduleId)

  // A schedule on Trigger.dev with no record here, left behind when saving
  // its record failed. It could never run for anyone, so it is removed rather
  // than fire, and cost a run, at every one of its times.
  if (!schedule) {
    await schedules.del(scheduleId)
    return { outcome: "no-record" }
  }

  // Turned off already. A run that was on its way when it was turned off can
  // still arrive.
  if (!schedule.active) return { outcome: "inactive" }

  const { orgId, workflowId } = schedule

  // Schedules are Pro, and the org's plan can have changed since this one was
  // saved. A scheduled run has no session to ask has() of, so Clerk's Backend
  // API answers. A failure there fails the run rather than decide anything
  // (see fetchOrgIsPro).
  const isPro = await fetchOrgIsPro(orgId, {
    secretKey: process.env.CLERK_SECRET_KEY,
  })

  if (!isPro) {
    await schedules.deactivate(schedule.triggerScheduleId)
    await deactivateWorkflowSchedule(schedule.triggerScheduleId)
    return { outcome: "plan-required" }
  }

  // Saving a schedule publishes the canvas, so a version is always there. This
  // guards a workflow whose versions went anyway.
  const version = await getLatestWorkflowVersion(orgId, workflowId)
  if (!version) return { outcome: "no-version" }

  const started = await startWorkflowRun({
    orgId,
    workflowId,
    isPro,
    version: async () => version,
    tags: [SCHEDULED_RUN_TAG],
  })

  if (started.outcome === "already-going") {
    return { outcome: "already-going", runId: started.runId }
  }

  // Out of runs for the month. The schedule stays on, unlike an org that left
  // Pro: a quota comes back with the next month, and turning the schedule off
  // would need someone to notice and turn it on again.
  if (started.outcome === "over-quota") return { outcome: "over-quota" }

  // The run goes ahead, and the worker writes the row itself when it starts.
  // Reported, since the row is late until then.
  if (started.recordError !== undefined) {
    Sentry.captureException(started.recordError, {
      tags: { area: "executions", trigger: "schedule" },
      extra: { orgId, workflowId, runId: started.runId },
    })
  }

  return { outcome: "started", runId: started.runId }
}
