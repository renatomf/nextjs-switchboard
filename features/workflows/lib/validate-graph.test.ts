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

  // Characterization tests: they pin down what validateGraph does today,
  // gaps included. Fixing one of these is a deliberate change that updates the
  // test in the same commit. See "Achados" in docs/roadmap.md.
  describe("current gaps", () => {
    it("accepts a graph whose Start is not connected to anything", () => {
      const problems = validateGraph({
        nodes: [node("start", "trigger"), node("a"), node("b")],
        edges: [edge("a", "b")],
      })

      expect(problems).toEqual([])
    })

    it("accepts an edge pointing at a node that is not in the graph", () => {
      const problems = validateGraph({
        nodes: [node("start", "trigger"), node("a")],
        edges: [edge("start", "a"), edge("a", "deleted")],
      })

      expect(problems).toEqual([])
    })
  })
})
