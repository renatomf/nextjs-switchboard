import { logger, schedules } from "@trigger.dev/sdk"

import { SCHEDULED_WORKFLOW_TASK_ID } from "@/features/workflows/lib/schedule-presets"
import { runScheduledWorkflow } from "@/features/workflows/tasks/scheduled-run"

// Fired by every workflow's schedule. There is no cron here: each schedule is
// made in code when a workflow is scheduled (saveWorkflowScheduleAction), and
// Trigger.dev hands the run the id of the one that fired.
export const runScheduledWorkflowTask = schedules.task({
  id: SCHEDULED_WORKFLOW_TASK_ID,
  // The run this starts has its own queue and retries. A failure here, such as
  // Clerk not answering, is tried again at the schedule's next time.
  retry: { maxAttempts: 1 },
  maxDuration: 120,
  run: async (payload) => {
    const result = await runScheduledWorkflow({
      scheduleId: payload.scheduleId,
    })

    logger.log("Scheduled workflow", {
      ...result,
      workflowId: payload.externalId,
    })

    return result
  },
})
