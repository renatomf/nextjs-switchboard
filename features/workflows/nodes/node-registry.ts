import type { Node } from "@xyflow/react"
import {
  Bot,
  Globe,
  Mail,
  MousePointerClick,
  ScanSearch,
  ScanText,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

export type StepNodeKind = "trigger" | "action"

// One editable field on a node, rendered as an input in the inspector later.
export type NodeField = {
  key: string
  label: string
  placeholder?: string
  // Render as a textarea instead of a single-line input.
  multiline?: boolean
  required?: boolean
}

export type NodeOutput = {
  path: string
  label: string
}

// A node type's manifest entry. Add a node by adding an entry to nodeRegistry.
export type NodeDefinition = {
  type: string
  kind: StepNodeKind
  label: string
  icon: LucideIcon
  accent: string // Tailwind classes for the icon chip color
  fields: NodeField[]
  outputs: NodeOutput[]
  // Only orgs on the pro plan can add this node. The toolbar reads the flag
  // rather than naming node types, so making another node premium is this one
  // line. Nodes without it are free — the default stays open.
  premium?: boolean
}

export const nodeRegistry = {
  start: {
    type: "start",
    kind: "trigger",
    label: "Start",
    icon: MousePointerClick,
    accent: "bg-blue-500 text-white",
    fields: [],
    outputs: [],
  },
  "open-url": {
    type: "open-url",
    kind: "action",
    label: "Open URL",
    icon: Globe,
    accent: "bg-emerald-500 text-white",
    fields: [
      {
        key: "url",
        label: "URL",
        placeholder: "https://youtube.com",
        required: true,
      },
      // { key: "description", label: "Description", placeholder: "Big text", multiline: true },
    ],
    outputs: [
      { path: "url", label: "URL" },
      { path: "title", label: "Title" },
    ],
  },
  act: {
    type: "act",
    kind: "action",
    label: "Act",
    icon: Sparkles,
    accent: "bg-violet-500 text-white",
    fields: [
      {
        key: "instruction",
        label: "Instruction",
        placeholder: "Click the sign in button",
        multiline: true,
        required: true,
      },
    ],
    outputs: [
      { path: "success", label: "Success" },
      { path: "message", label: "Message" },
      { path: "url", label: "URL" },
    ],
  },
  extract: {
    type: "extract",
    kind: "action",
    label: "Extract",
    icon: ScanText,
    accent: "bg-amber-500 text-white",
    fields: [
      {
        key: "instruction",
        label: "Instruction",
        placeholder: "Extract the headline and the author name",
        multiline: true,
        required: true,
      },
    ],
    outputs: [{ path: "extraction", label: "Extraction" }],
  },
  observe: {
    type: "observe",
    kind: "action",
    label: "Observe",
    icon: ScanSearch,
    accent: "bg-sky-500 text-white",
    fields: [
      {
        key: "instruction",
        label: "Instruction",
        placeholder: "Find the pagination controls",
        multiline: true,
        required: true,
      },
    ],
    outputs: [{ path: "matches", label: "Matches" }],
  },
  agent: {
    type: "agent",
    kind: "action",
    label: "Agent",
    icon: Bot,
    accent: "bg-rose-500 text-white",
    // Runs a full CUA loop — many model calls per step, our costliest node.
    premium: true,
    fields: [
      {
        key: "instruction",
        label: "Instruction",
        placeholder:
          "Search for a laptop under $1000 and open the best rated result",
        multiline: true,
        required: true,
      },
    ],
    outputs: [
      { path: "success", label: "Success" },
      { path: "message", label: "Message" },
      { path: "completed", label: "Completed" },
    ],
  },
  "send-email": {
    type: "send-email",
    kind: "action",
    label: "Send Email",
    icon: Mail,
    accent: "bg-indigo-500 text-white",
    fields: [
      {
        key: "to",
        label: "To",
        placeholder: "delivered@resend.dev",
        required: true,
      },
      {
        key: "subject",
        label: "Subject",
        placeholder: "Your report is ready",
        required: true,
      },
      {
        key: "body",
        label: "Body",
        placeholder: "Here is what the run found...",
        multiline: true,
        required: true,
      },
    ],
    outputs: [{ path: "id", label: "Email ID" }],
  },
} satisfies Record<string, NodeDefinition>

export type NodeType = keyof typeof nodeRegistry

// Whether a node type is gated behind the pro plan. A function rather than a
// bare `nodeRegistry[type].premium` read at each call site: `satisfies` keeps
// every entry's literal type, so the entries that don't set the flag genuinely
// have no such key and the union can't be read through.
export function isPremiumNode(type: NodeType): boolean {
  const def: NodeDefinition = nodeRegistry[type]
  return def.premium === true
}

// Plain JSON only (synced through Liveblocks later). type keys into the registry;
// kind and title are denormalized so the server can read them without the registry.
export type StepNodeData = {
  type: NodeType
  kind: StepNodeKind
  title: string
  values: Record<string, string>
}

export type StepNodeType = Node<StepNodeData, "step">

export type ActionNodeType = {
  [K in NodeType]: (typeof nodeRegistry)[K]["kind"] extends "action" ? K : never
}[NodeType]
