import type { Edge } from "@xyflow/react"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

// A relative path rather than "@/": unlike the type-only import below, this
// one survives compilation, so it has to resolve wherever the schema is
// loaded, drizzle-kit included.
import {
  EXECUTION_STATUSES,
  type ExecutionStatus,
} from "../../features/workflows/lib/execution-status"
import type { SchedulePreset } from "@/features/workflows/lib/schedule-presets"
import type { StepNodeType } from "@/features/workflows/nodes/node-registry"

// Canonical, server-readable snapshot of the flow. Mirrors React Flow's own
// shape 1:1 so a future executor can read it without remapping. Persisted by the
// Run action; the live editing copy still lives in the Liveblocks room.
export type WorkflowGraph = { nodes: StepNodeType[]; edges: Edge[] }

// Every timestamp carries its time zone. A plain `timestamp` has none, and the
// pg driver reads one in the zone of whichever machine is reading, which
// shifted times by hours between machines.
const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    graph: jsonb("graph").$type<WorkflowGraph>(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
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
    createdAt: timestamptz("created_at").defaultNow().notNull(),
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

// One row per Trigger.dev run: the durable record of what ran, for whom, and
// how it ended. Trigger.dev keeps runs for a while; this keeps them for good,
// and it is what ties a run and its browser session to an org.
export const executions = pgTable(
  "executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The key the app and the worker meet on. Either may write a run's row
    // first, so both insert on conflict with it rather than assume the other
    // already has.
    runId: text("run_id").notNull().unique(),
    orgId: text("org_id").notNull(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    // Null only for a run triggered by an app that predates versions.
    versionId: uuid("version_id").references(() => workflowVersions.id, {
      onDelete: "cascade",
    }),
    status: text("status").$type<ExecutionStatus>().notNull().default("queued"),
    // Known once the run opens a browser; many runs never do.
    browserbaseSessionId: text("browserbase_session_id"),
    // The message of whatever failed the run.
    error: text("error"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
  },
  (table) => [
    // The same list the state machine uses, so a status it does not know
    // cannot reach the table.
    check(
      "executions_status_check",
      sql`${table.status} IN (${sql.raw(EXECUTION_STATUSES.map((s) => `'${s}'`).join(", "))})`
    ),
    // A workflow's run history, newest first; also what the cascade from a
    // deleted workflow uses.
    index("executions_workflow_id_created_at_idx").on(
      table.workflowId,
      table.createdAt
    ),
    // The cascade from a deleted version would otherwise scan the table.
    index("executions_version_id_idx").on(table.versionId),
    // The replay route finds a run by its browser session. One session
    // belongs to one run; runs without a session are all null, which a
    // unique index allows.
    uniqueIndex("executions_browserbase_session_id_idx").on(
      table.browserbaseSessionId
    ),
  ]
)

// When Trigger.dev runs a workflow on its own. The schedule itself lives on
// Trigger.dev; this row is what the app knows of it: which workflow and org it
// belongs to, and the preset it was made from.
export const workflowSchedules = pgTable(
  "workflow_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    // The Trigger.dev environment the schedule lives in ("dev", "prod").
    // Development and production share this database, so the same workflow can
    // have a schedule in each.
    environment: text("environment").notNull(),
    preset: jsonb("preset").$type<SchedulePreset>().notNull(),
    timezone: text("timezone").notNull(),
    // The schedule's id on Trigger.dev, for updating or removing it.
    triggerScheduleId: text("trigger_schedule_id").notNull(),
    // Off once the org is no longer on a plan that includes schedules: the
    // run that finds this turns the schedule off on Trigger.dev as well.
    active: boolean("active").notNull().default(true),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // One schedule per workflow in each environment.
    uniqueIndex("workflow_schedules_workflow_id_environment_idx").on(
      table.workflowId,
      table.environment
    ),
    // A scheduled run finds its schedule by the id Trigger.dev hands it.
    uniqueIndex("workflow_schedules_trigger_schedule_id_idx").on(
      table.triggerScheduleId
    ),
    // Counting an org's schedules, against its share of the project's.
    index("workflow_schedules_org_id_environment_idx").on(
      table.orgId,
      table.environment
    ),
  ]
)

export type WorkflowSchedule = typeof workflowSchedules.$inferSelect
