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

// One immutable snapshot of a workflow's graph per Run. The canvas keeps
// changing in Liveblocks; a version is what a run actually executes, so a run
// reads its own graph even when someone else hits Run a moment later.
export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    // Copied from the workflow so every query can be scoped by org, like the
    // rest of the data layer, without a join.
    orgId: text("org_id").notNull(),
    graph: jsonb("graph").$type<WorkflowGraph>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Postgres does not index a foreign key on its own. Without this, deleting
    // a workflow would scan every version to find the ones to cascade to. The
    // created_at after it also serves a workflow's history, newest first.
    index("workflow_versions_workflow_id_created_at_idx").on(
      table.workflowId,
      table.createdAt
    ),
  ]
)
