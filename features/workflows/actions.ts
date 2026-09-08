"use server"

import { auth } from "@clerk/nextjs/server"
import { LiveblocksError } from "@liveblocks/node"
import { tasks, runs } from "@trigger.dev/sdk"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import type { helloWorldTask } from "@/trigger/example"
import type { runWorkflowTask } from "@/features/workflows/tasks/run-workflow"

import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  saveWorkflowGraph
} from "@/features/workflows/data"
import {
  isPremiumNode,
  nodeRegistry,
} from "@/features/workflows/nodes/node-registry"
import { PRO_PLAN } from "@/lib/billing"
import { getLiveblocks } from "@/lib/liveblocks"
import { WorkflowGraph } from "@/lib/db/schema"

export async function createWorkflowAction(name: string) {
  const { orgId } = await auth()

  if (!orgId) {
    throw new Error("No active organization")
  }

  const workflow = await createWorkflow(orgId, name)

  // The workflow list lives in the (dashboard) layout, which wraps both "/" and
  // "/workflows/[id]", so revalidate from the root to refresh it everywhere.
  revalidatePath("/", "layout")
  redirect(`/workflows/${workflow.id}`)
}

export async function deleteWorkflowAction(workflowId: string) {
  const { orgId } = await auth()

  if (!orgId) {
    throw new Error("No active organization")
  }

  // Scope the lookup to the org so one organization can't delete another's
  // workflow by guessing its id.
  const workflow = await getWorkflow(orgId, workflowId)

  if (!workflow) {
    throw new Error("Workflow not found")
  }

  // The workflow id doubles as its Liveblocks room id - clean it up too. The
  // room goes first: if this throws, the row survives, so the workflow is still
  // reachable and the user can retry. Dropping the row first would strand the
  // room under an id nothing references any more.
  try {
    await getLiveblocks().deleteRoom(workflowId)
  } catch (error) {
    // A room only exists once someone has opened the workflow, so a 404 means
    // there was never one to delete. Anything else is a real failure.
    if (!(error instanceof LiveblocksError) || error.status !== 404) {
      throw error
    }
  }

  await deleteWorkflow(orgId, workflowId)

  // No redirect here: a redirecting server action rejects its client-side
  // promise, which would make the caller's catch fire on success. The caller
  // navigates instead.
  revalidatePath("/", "layout")
}

export async function runWorkflowAction({
  id,
  graph
}: {
  id: string
  graph: WorkflowGraph
}) {
  const { orgId, has } = await auth()

  if (!orgId) {
    throw new Error("No active organization")
  }

  // Premium nodes are gated at run time, not just in the toolbar. A graph can
  // hold one without anyone having clicked a locked button: the org may have
  // downgraded since, or a pro member on the same Liveblocks canvas may have
  // added it. This is the last point that can stop it — the Trigger.dev task
  // runs without a Clerk session, so it has no has() to ask.
  //
  // Checked before the save so a rejected run doesn't persist the graph that
  // caused it.
  if (!has({ plan: PRO_PLAN })) {
    // Deduped: a workflow can hold several Agent nodes, and naming the node
    // once is what the message needs.
    const premium = [
      ...new Set(
        graph.nodes
          .filter((node) => isPremiumNode(node.data.type))
          .map((node) => nodeRegistry[node.data.type].label)
      ),
    ]

    if (premium.length > 0) {
      throw new Error(
        `${premium.join(", ")} requires the Pro plan. Upgrade to run this workflow.`
      )
    }
  }

  await saveWorkflowGraph({ orgId, id, graph })

  const handle = await tasks.trigger<typeof runWorkflowTask>(
    "run-workflow",
    { workflowId: id, orgId },
    { tags: [`workflow:${id}`] },
  )
  
  return handle
}

export async function cancelWorkflowRunAction(runId: string) {
  const { orgId } = await auth()
  if (!orgId) throw new Error("No active organization")
  await runs.cancel(runId)
}
