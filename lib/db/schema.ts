import type { Edge } from "@xyflow/react"
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import type { StepNodeType } from "@/features/workflows/nodes/node-registry"

// Canonical, server-readable snapshot of the flow. Mirrors React Flow's own
// shape 1:1 so a future executor can read it without remapping. Persisted by the
// Run action; the live editing copy still lives in the Liveblocks room.
export type WorkflowGraph = { nodes: StepNodeType[]; edges: Edge[] }

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    graph: jsonb("graph").$type<WorkflowGraph>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // The workflow list is always one org's, newest first (listWorkflows).
    // Leading with org_id keeps that lookup from reading every other org's
    // rows, and created_at after it serves the ORDER BY as well: a B-tree
    // scans backwards as cheaply as forwards, so it needs no DESC.
    index("workflows_org_id_created_at_idx").on(table.orgId, table.createdAt),
  ]
)

export type Workflow = typeof workflows.$inferSelect
