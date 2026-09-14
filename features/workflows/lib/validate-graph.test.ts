import type { Edge } from "@xyflow/react"
import { describe, expect, it } from "vitest"

import type { StepNodeType } from "@/features/workflows/nodes/node-registry"
import { validateGraph } from "./validate-graph"

// Just enough of a React Flow node for validateGraph, which only reads
// data.kind. The rest is filler to satisfy the type.
function node(id: string, kind: "trigger" | "action" = "action"): StepNodeType {
  return {
    id,
    type: "step",
    position: { x: 0, y: 0 },
    data: {
      type: kind === "trigger" ? "start" : "act",
      kind,
      title: id,
      values: {},
    },
  }
}

function edge(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target }
}

describe("validateGraph", () => {
  it("accepts a Start connected to a chain of actions", () => {
    const problems = validateGraph({
      nodes: [node("start", "trigger"), node("a"), node("b")],
      edges: [edge("start", "a"), edge("a", "b")],
    })

    expect(problems).toEqual([])
  })

  it("requires a Start trigger", () => {
    const problems = validateGraph({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b")],
    })

    expect(problems).toEqual([
      "A workflow needs exactly one Start trigger (found 0).",
    ])
  })

  it("rejects more than one Start trigger", () => {
    const problems = validateGraph({
      nodes: [node("s1", "trigger"), node("s2", "trigger"), node("a")],
      edges: [edge("s1", "a"), edge("s2", "a")],
    })

    expect(problems).toEqual([
      "A workflow needs exactly one Start trigger (found 2).",
    ])
  })

  it("rejects a graph with no edges, since the runner would do nothing", () => {
    const problems = validateGraph({
      nodes: [node("start", "trigger"), node("a")],
      edges: [],
    })

    expect(problems).toEqual(["Connect your nodes before running."])
  })

  it("rejects a cycle", () => {
    const problems = validateGraph({
      nodes: [node("start", "trigger"), node("a"), node("b")],
      edges: [edge("start", "a"), edge("a", "b"), edge("b", "a")],
    })

    expect(problems).toEqual([
      "Workflow has a cycle — remove the loop before running.",
    ])
  })

  it("rejects a node wired to itself", () => {
    const problems = validateGraph({
      nodes: [node("start", "trigger"), node("a")],
      edges: [edge("start", "a"), edge("a", "a")],
    })

    expect(problems).toEqual([
      "Workflow has a cycle — remove the loop before running.",
    ])
  })

  it("reports every problem at once instead of stopping at the first", () => {
    const problems = validateGraph({ nodes: [node("a")], edges: [] })

    expect(problems).toEqual([
      "A workflow needs exactly one Start trigger (found 0).",
      "Connect your nodes before running.",
    ])
  })

  // These started as characterization tests of two gaps. Each Run now saves
  // its graph as a permanent version, so a graph the run cannot execute must
  // not get that far.
  describe("connections", () => {
    it("rejects steps that Start does not reach", () => {
      const problems = validateGraph({
        nodes: [node("start", "trigger"), node("a"), node("b")],
        edges: [edge("a", "b")],
      })

      expect(problems).toEqual([
        "Some connected steps can't be reached from Start — connect them to the flow or remove their edges.",
      ])
    })

    it("rejects a branch that Start does not lead to", () => {
      const problems = validateGraph({
        nodes: [node("start", "trigger"), node("a"), node("b"), node("c")],
        edges: [edge("start", "a"), edge("b", "c")],
      })

      expect(problems).toEqual([
        "Some connected steps can't be reached from Start — connect them to the flow or remove their edges.",
      ])
    })

    it("accepts steps that fan out from Start", () => {
      const problems = validateGraph({
        nodes: [node("start", "trigger"), node("a"), node("b")],
        edges: [edge("start", "a"), edge("start", "b")],
      })

      expect(problems).toEqual([])
    })

    // A concurrent edit on the shared canvas can delete a step while another
    // user wires an edge to it. The run's toposort throws on that edge.
    it("rejects an edge pointing at a step that is no longer on the canvas", () => {
      const problems = validateGraph({
        nodes: [node("start", "trigger"), node("a")],
        edges: [edge("start", "a"), edge("a", "deleted")],
      })

      expect(problems).toEqual([
        "An edge points to a step that is no longer on the canvas — delete it before running.",
      ])
    })
  })
})
