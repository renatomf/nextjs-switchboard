import toposort from "toposort"

import { nodeRegistry } from "@/features/workflows/nodes/node-registry"
import type { WorkflowGraph } from "@/lib/db/schema"

// Every node the flow reaches by following edges out of `start`. Tracks what
// it has seen, so a cycle ends the walk instead of looping; the cycle itself is
// reported separately.
function reachableFrom(start: string, edges: WorkflowGraph["edges"]) {
  const next = new Map<string, string[]>()
  for (const { source, target } of edges) {
    next.set(source, [...(next.get(source) ?? []), target])
  }

  const reached = new Set([start])
  const queue = [start]
  while (queue.length > 0) {
    for (const target of next.get(queue.shift()!) ?? []) {
      if (reached.has(target)) continue
      reached.add(target)
      queue.push(target)
    }
  }

  return reached
}

// Structural problems knowable before a run — empty array means runnable. Pure
// (no db import) so the client can pre-flight the in-hand graph and toast,
// while the server reuses it as the save-time backstop.
export function validateGraph({ nodes, edges }: WorkflowGraph): string[] {
  const problems: string[] = []

  const triggers = nodes.filter((n) => n.data.kind === "trigger")
  if (triggers.length !== 1) {
    problems.push(
      `A workflow needs exactly one Start trigger (found ${triggers.length}).`
    )
  }

  // The runner only executes nodes touching an edge, so with none Run is a
  // no-op, and none of the checks below have anything to look at.
  if (edges.length === 0) {
    problems.push("Connect your nodes before running.")
    return problems
  }

  // A concurrent edit on the shared canvas can delete a step while another user
  // wires an edge to it. The run's toposort throws on such an edge.
  const ids = new Set(nodes.map((n) => n.id))
  if (edges.some((e) => !ids.has(e.source) || !ids.has(e.target))) {
    problems.push(
      "An edge points to a step that is no longer on the canvas — delete it before running."
    )
  }

  try {
    // toposort throws on a cycle — the run would otherwise fail mid-sort.
    toposort(edges.map((e) => [e.source, e.target]))
  } catch {
    problems.push("Workflow has a cycle — remove the loop before running.")
  }

  // The runner executes every step touching an edge, so each of those has to be
  // a step the flow actually gets to from Start. Only asked with exactly one
  // Start: with none or several, the problem above already says what is wrong.
  if (triggers.length === 1) {
    const reached = reachableFrom(triggers[0].id, edges)
    const stranded = edges
      .flatMap((e) => [e.source, e.target])
      .some((id) => ids.has(id) && !reached.has(id))

    if (stranded) {
      problems.push(
        "Some connected steps can't be reached from Start — connect them to the flow or remove their edges."
      )
    }
  }

  // Every step the run executes needs its required fields filled. An empty one
  // reaches the executor as undefined, and the run then fails mid-way with an
  // error from deep inside Stagehand instead of here, in words the user can act
  // on. A step loose on the canvas is not executed, so it is not checked.
  const executed = new Set(edges.flatMap((e) => [e.source, e.target]))
  for (const node of nodes) {
    if (!executed.has(node.id)) continue

    for (const field of nodeRegistry[node.data.type]?.fields ?? []) {
      if (field.required && !node.data.values?.[field.key]?.trim()) {
        problems.push(
          `Fill in "${field.label}" on ${node.data.title} before running.`
        )
      }
    }
  }

  return problems
}
