import { LiveblocksError } from "@liveblocks/node"
import { describe, expect, it, vi } from "vitest"

import type { WorkflowGraph } from "@/lib/db/schema"
import type {
  NodeType,
  StepNodeType,
} from "@/features/workflows/nodes/node-registry"
import {
  planRequiredMessage,
  premiumNodeLabels,
  premiumNodeLabelsOnCanvas,
} from "./premium-gate"

// Stands in for the Liveblocks room. Reading its storage is the only call the
// gate makes, so it is the only thing faked.
const getStorageDocument = vi.hoisted(() => vi.fn())

vi.mock("@/lib/liveblocks", () => ({
  getLiveblocks: () => ({ getStorageDocument }),
}))

function node(type: NodeType, id: string): StepNodeType {
  return {
    id,
    type: "step",
    position: { x: 0, y: 0 },
    data: {
      type,
      kind: type === "start" ? "trigger" : "action",
      title: id,
      values: {},
    },
  }
}

// A saved graph holding one node of each type given.
function graph(...types: NodeType[]): WorkflowGraph {
  return { nodes: types.map((type, i) => node(type, `n${i}`)), edges: [] }
}

// A room's storage as @liveblocks/react-flow shapes it: nodes keyed by id.
// Types are plain strings here, the way they come out of storage.
function room(...types: string[]) {
  return {
    flow: {
      nodes: Object.fromEntries(
        types.map((type, i) => [`n${i}`, { data: { type } }])
      ),
    },
  }
}

function liveblocksError(status: number) {
  return LiveblocksError.from(new Response("{}", { status }))
}

describe("premiumNodeLabels", () => {
  it("finds nothing in a workflow that was never run", () => {
    expect(premiumNodeLabels(null)).toEqual([])
  })

  it("finds nothing when every node is free", () => {
    const free = graph("start", "open-url", "act", "extract", "observe")

    expect(premiumNodeLabels(free)).toEqual([])
  })

  it("names a premium node by its label", () => {
    expect(premiumNodeLabels(graph("start", "agent"))).toEqual(["Agent"])
  })

  it("names each premium node type once", () => {
    expect(premiumNodeLabels(graph("start", "agent", "agent"))).toEqual([
      "Agent",
    ])
  })
})

describe("planRequiredMessage", () => {
  it("speaks of a single node", () => {
    expect(planRequiredMessage(["Agent"])).toBe(
      "The Agent node requires the Pro plan"
    )
  })

  it("joins two nodes with 'and'", () => {
    expect(planRequiredMessage(["Agent", "Vault"])).toBe(
      "The Agent and Vault nodes require the Pro plan"
    )
  })

  it("lists three or more nodes with commas and a final 'and'", () => {
    expect(planRequiredMessage(["Agent", "Vault", "Cron"])).toBe(
      "The Agent, Vault and Cron nodes require the Pro plan"
    )
  })
})

describe("premiumNodeLabelsOnCanvas", () => {
  // A workflow built on Pro and never run has its Agent node in the room and
  // nothing in Postgres, so the room is what the gate has to read.
  it("reads the live room rather than the saved snapshot", async () => {
    getStorageDocument.mockResolvedValueOnce(room("start", "agent"))

    const labels = await premiumNodeLabelsOnCanvas("wf_1", graph("start"))

    expect(labels).toEqual(["Agent"])
    expect(getStorageDocument).toHaveBeenCalledWith("wf_1", "json")
  })

  it("finds nothing in a room whose nodes are all free", async () => {
    getStorageDocument.mockResolvedValueOnce(room("start", "act"))

    expect(await premiumNodeLabelsOnCanvas("wf_1", null)).toEqual([])
  })

  it("ignores node types this build does not know", async () => {
    getStorageDocument.mockResolvedValueOnce(room("legacy-scraper", "agent"))

    expect(await premiumNodeLabelsOnCanvas("wf_1", null)).toEqual(["Agent"])
  })

  it.each([
    ["an empty document", null],
    ["no flow", {}],
    ["no nodes", { flow: {} }],
    ["nodes that are not an object", { flow: { nodes: "oops" } }],
    ["nodes without data", { flow: { nodes: { a: null, b: {} } } }],
  ])(
    "sees nothing, instead of throwing, in a room with %s",
    async (_, storage) => {
      getStorageDocument.mockResolvedValueOnce(storage)

      expect(await premiumNodeLabelsOnCanvas("wf_1", null)).toEqual([])
    }
  )

  // A room only exists once someone has opened the workflow.
  it("falls back to the saved graph when the room was never created", async () => {
    getStorageDocument.mockRejectedValueOnce(await liveblocksError(404))

    const labels = await premiumNodeLabelsOnCanvas(
      "wf_1",
      graph("start", "agent")
    )

    expect(labels).toEqual(["Agent"])
  })

  // Swallowing an error would read as "no premium nodes" and open the gate,
  // which is the one answer the gate must never guess.
  describe("fails closed", () => {
    it("rethrows any other Liveblocks error", async () => {
      const error = await liveblocksError(500)
      getStorageDocument.mockRejectedValueOnce(error)

      await expect(
        premiumNodeLabelsOnCanvas("wf_1", graph("start"))
      ).rejects.toBe(error)
    })

    it("rethrows errors that do not come from Liveblocks", async () => {
      const error = new Error("socket hang up")
      getStorageDocument.mockRejectedValueOnce(error)

      await expect(
        premiumNodeLabelsOnCanvas("wf_1", graph("start"))
      ).rejects.toBe(error)
    })
  })
})
