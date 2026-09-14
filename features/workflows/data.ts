import { and, desc, eq } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { workflows, workflowVersions, WorkflowGraph } from "@/lib/db/schema"
import { validateGraph } from "./lib/validate-graph"

// Freezes the graph a Run is about to execute as a new, immutable version and
// returns it. The workflow's own graph column is kept in step as the latest
// snapshot, for readers that want the current graph: the plan gate's fallback,
// and runs triggered before versions existed. One transaction, so the two
// never disagree.
export async function publishWorkflowVersion({
  orgId,
  workflowId,
  graph,
}: {
  orgId: string
  workflowId: string
  graph: WorkflowGraph
}) {
  const problems = validateGraph(graph)
  if (problems.length > 0) throw new Error(problems.join(" "))

  return getDb().transaction(async (tx) => {
    // Scoped to the org: an id from another org updates nothing, and then
    // there is nothing to publish.
    const [workflow] = await tx
      .update(workflows)
      .set({ graph, updatedAt: new Date() })
      .where(and(eq(workflows.id, workflowId), eq(workflows.orgId, orgId)))
      .returning({ id: workflows.id })

    if (!workflow) throw new Error("Workflow not found")

    const [version] = await tx
      .insert(workflowVersions)
      .values({ workflowId, orgId, graph })
      .returning()

    return version
  })
}

export async function getWorkflowVersion(orgId: string, id: string) {
  const [version] = await getDb()
    .select()
    .from(workflowVersions)
    .where(and(eq(workflowVersions.id, id), eq(workflowVersions.orgId, orgId)))

  return version
}

export function listWorkflows(orgId: string) {
  return getDb()
    .select()
    .from(workflows)
    .where(eq(workflows.orgId, orgId))
    .orderBy(desc(workflows.createdAt))
}

export async function getWorkflow(orgId: string, id: string) {
  const [workflow] = await getDb()
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.orgId, orgId)))

  return workflow
}

export async function createWorkflow(orgId: string, name: string) {
  const [workflow] = await getDb()
    .insert(workflows)
    .values({ orgId, name })
    .returning()

  return workflow
}

export async function deleteWorkflow(orgId: string, id: string) {
  const [workflow] = await getDb()
    .delete(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.orgId, orgId)))
    .returning()

  return workflow
}
