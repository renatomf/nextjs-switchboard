import { getWorkflow, getWorkflowVersion } from "@/features/workflows/data"
import type { WorkflowGraph } from "@/lib/db/schema"

// What the Run action triggers the workflow task with.
export type RunWorkflowPayload = {
  workflowId: string
  orgId: string
  // The immutable version the run was started with. Optional only for runs
  // triggered by an app deployed before versions existed: the web app and the
  // worker deploy separately, so for a while both payload shapes can arrive.
  versionId?: string
}

// The graph a run executes. Given a version, exactly that version's graph and
// never the workflow's latest: falling back would let a later Run swap the
// graph under this one, which is the race versions exist to close.
export async function loadRunGraph({
  workflowId,
  orgId,
  versionId,
}: RunWorkflowPayload): Promise<WorkflowGraph> {
  if (versionId) {
    const version = await getWorkflowVersion(orgId, versionId)
    if (!version) throw new Error(`Workflow version ${versionId} not found`)

    return version.graph
  }

  const workflow = await getWorkflow(orgId, workflowId)
  if (!workflow?.graph) throw new Error(`Workflow ${workflowId} has no graph`)

  return workflow.graph
}
