import { LiveblocksError } from "@liveblocks/node"

import {
  isPremiumNode,
  nodeRegistry,
  type NodeType,
} from "@/features/workflows/nodes/node-registry"
import { getLiveblocks } from "@/lib/liveblocks"
import type { WorkflowGraph } from "@/lib/db/schema"

// Node types off a canvas are strings from storage, not a trusted union — an
// unknown one is a node this build doesn't have and simply isn't premium.
// Deduped, because a workflow can hold several Agent nodes and naming the node
// once is what a message needs.
function premiumLabelsForTypes(types: string[]): string[] {
  const labels = new Set<string>()

  for (const type of types) {
    if (!(type in nodeRegistry)) continue

    const known = type as NodeType
    if (isPremiumNode(known)) labels.add(nodeRegistry[known].label)
  }

  return [...labels]
}

// The premium node labels in a saved graph. Null-tolerant: the `graph` column
// is only written on Run, so a workflow that was built but never run has none.
export function premiumNodeLabels(graph: WorkflowGraph | null): string[] {
  if (!graph) return []

  return premiumLabelsForTypes(graph.nodes.map((node) => node.data.type))
}

// The canvas as Liveblocks stores it. Only the node types are read, so this is
// deliberately loose — the room is shaped by @liveblocks/react-flow, and a
// change there should make the gate see nothing rather than throw.
function nodeTypesInStorage(storage: unknown): string[] {
  const nodes = (
    storage as { flow?: { nodes?: Record<string, unknown> } } | null
  )?.flow?.nodes

  if (!nodes || typeof nodes !== "object") return []

  return Object.values(nodes)
    .map((node) => (node as { data?: { type?: unknown } } | null)?.data?.type)
    .filter((type): type is string => typeof type === "string")
}

// The premium node labels actually on a workflow's canvas.
//
// The room is the live copy and the `graph` column is a snapshot taken on Run,
// so a workflow built on Pro and never run has its Agent node in the room and
// nothing in Postgres. Reading the room is what makes the gate see what the
// user sees; the saved graph is the fallback for a workflow nobody has opened.
export async function premiumNodeLabelsOnCanvas(
  workflowId: string,
  graph: WorkflowGraph | null
): Promise<string[]> {
  try {
    const storage = await getLiveblocks().getStorageDocument(workflowId, "json")

    return premiumLabelsForTypes(nodeTypesInStorage(storage))
  } catch (error) {
    // A room only exists once someone has opened the workflow, so a 404 means
    // the saved graph is all there is to go on. Anything else is a real
    // failure — swallowing it would read as "no premium nodes" and open the
    // gate, which is the one answer this must never guess.
    if (error instanceof LiveblocksError && error.status === 404) {
      return premiumNodeLabels(graph)
    }

    throw error
  }
}

// "The Agent node requires the Pro plan" — one sentence built in one place, so
// the screen the user lands on and the Sentry issue that gets filed read the
// same. Callers pass the labels from the helpers above; an empty list is not a
// refusal and should never reach here.
export function planRequiredMessage(labels: string[]): string {
  if (labels.length > 1) {
    const names = `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
    return `The ${names} nodes require the Pro plan`
  }

  return `The ${labels[0]} node requires the Pro plan`
}
