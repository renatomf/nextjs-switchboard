// The Trigger.dev task every workflow run goes through.
export const RUN_WORKFLOW_TASK_ID = "run-workflow"

// The tag the Run action stamps on each run of a workflow. The canvas
// subscribes to runs by it, the browser's public token is scoped to it, and
// cancelling checks it, so all three have to agree on one spelling.
export function workflowRunTag(workflowId: string) {
  return `workflow:${workflowId}`
}

// Whether a run belongs to a workflow: it has to be a run of the workflow task
// and carry that workflow's tag. Tags are set by our server when it triggers
// the run, so a client cannot forge one.
export function isRunOfWorkflow(
  run: { taskIdentifier: string; tags: string[] },
  workflowId: string
): boolean {
  return (
    run.taskIdentifier === RUN_WORKFLOW_TASK_ID &&
    run.tags.includes(workflowRunTag(workflowId))
  )
}
