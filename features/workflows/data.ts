import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  executions,
  workflows,
  workflowSchedules,
  workflowVersions,
  WorkflowGraph,
  type WorkflowSchedule,
} from "@/lib/db/schema"
import {
  allowedFrom,
  statusAfter,
  type ExecutionEvent,
} from "./lib/execution-status"
import { validateGraph } from "./lib/validate-graph"

// Freezes the graph a Run is about to execute as a new, immutable version and
// returns it. The workflow's own graph column is kept in step as the latest
// snapshot, for readers that want the current graph: the plan gate's fallback,
// and runs triggered before versions existed. One transaction, so the two
// never disagree.
export async function publishWorkflowVersion({
  orgId,
  workflowId,
  graph,
}: {
  orgId: string
  workflowId: string
  graph: WorkflowGraph
}) {
  const problems = validateGraph(graph)
  if (problems.length > 0) throw new Error(problems.join(" "))

  return getDb().transaction(async (tx) => {
    // Scoped to the org: an id from another org updates nothing, and then
    // there is nothing to publish.
    const [workflow] = await tx
      .update(workflows)
      .set({ graph, updatedAt: new Date() })
      .where(and(eq(workflows.id, workflowId), eq(workflows.orgId, orgId)))
      .returning({ id: workflows.id })

    if (!workflow) throw new Error("Workflow not found")

    const [version] = await tx
      .insert(workflowVersions)
      .values({ workflowId, orgId, graph })
      .returning()

    return version
  })
}

export async function getWorkflowVersion(orgId: string, id: string) {
  const [version] = await getDb()
    .select()
    .from(workflowVersions)
    .where(and(eq(workflowVersions.id, id), eq(workflowVersions.orgId, orgId)))

  return version
}

// Records a run as queued the moment it is triggered. The worker may already
// have written the row (a run can start before the trigger call returns), and
// then that row stands.
export async function recordExecution({
  runId,
  orgId,
  workflowId,
  versionId,
}: {
  runId: string
  orgId: string
  workflowId: string
  versionId: string
}) {
  await getDb()
    .insert(executions)
    .values({ runId, orgId, workflowId, versionId })
    .onConflictDoNothing({ target: executions.runId })
}

// Moves a run's execution forward by one event, creating the row if this is
// the first write to reach it. The state machine's guard sits in the upsert
// itself (setWhere), so the check and the write are one statement: a late
// hook or a cancel racing the worker cannot undo how a run ended.
export async function advanceExecution({
  runId,
  orgId,
  workflowId,
  versionId,
  event,
  error,
  at = new Date(),
}: {
  runId: string
  orgId: string
  workflowId: string
  versionId?: string
  event: ExecutionEvent
  error?: string
  at?: Date
}) {
  const changes = {
    status: statusAfter(event),
    ...(event === "started" ? { startedAt: at } : { finishedAt: at }),
    ...(error === undefined ? {} : { error }),
  }

  await getDb()
    .insert(executions)
    .values({ runId, orgId, workflowId, versionId, ...changes })
    .onConflictDoUpdate({
      target: executions.runId,
      set: changes,
      setWhere: inArray(executions.status, [...allowedFrom(event)]),
    })
}

// Runs fn while holding a lock on starting a run of this workflow, so two Runs
// landing together take turns instead of both finding no run going. A
// transaction-scoped advisory lock: it is released when the transaction ends,
// however fn ends, and it works through PgBouncer's transaction pooling. The
// transaction holds a pooled connection for as long as fn takes, a couple of
// seconds around the call to Trigger.dev.
export async function withWorkflowRunLock<T>(
  workflowId: string,
  fn: () => Promise<T>
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`run-start:${workflowId}`}, 0))`
    )
    return fn()
  })
}

// The newest execution of this workflow that has not settled, if any.
export async function getLatestUnsettledExecution(
  orgId: string,
  workflowId: string
) {
  const [execution] = await getDb()
    .select({ runId: executions.runId })
    .from(executions)
    .where(
      and(
        eq(executions.orgId, orgId),
        eq(executions.workflowId, workflowId),
        inArray(executions.status, ["queued", "running"])
      )
    )
    .orderBy(desc(executions.createdAt))
    .limit(1)

  return execution
}

// Executions not settled yet that were created before a point in time, newest
// first. What the reconciliation checks against Trigger.dev. Across every org:
// it is the system looking after its own records, not a request from one.
export function listUnsettledExecutions({
  createdBefore,
  limit,
}: {
  createdBefore: Date
  limit: number
}) {
  return getDb()
    .select({
      runId: executions.runId,
      orgId: executions.orgId,
      workflowId: executions.workflowId,
      versionId: executions.versionId,
    })
    .from(executions)
    .where(
      and(
        inArray(executions.status, ["queued", "running"]),
        lt(executions.createdAt, createdBefore)
      )
    )
    .orderBy(desc(executions.createdAt))
    .limit(limit)
}

export async function setExecutionBrowserSession(
  runId: string,
  browserbaseSessionId: string
) {
  await getDb()
    .update(executions)
    .set({ browserbaseSessionId })
    .where(eq(executions.runId, runId))
}

// The execution that opened a browser session, if it is this org's. What the
// replay route asks before it hands out a recording.
export async function getExecutionBySession(
  orgId: string,
  browserbaseSessionId: string
) {
  const [execution] = await getDb()
    .select({ runId: executions.runId })
    .from(executions)
    .where(
      and(
        eq(executions.browserbaseSessionId, browserbaseSessionId),
        eq(executions.orgId, orgId)
      )
    )

  return execution
}

// The schedule a workflow has in this Trigger.dev environment, if the workflow
// is this org's.
export async function getWorkflowSchedule(
  orgId: string,
  workflowId: string,
  environment: string
) {
  const [schedule] = await getDb()
    .select()
    .from(workflowSchedules)
    .where(
      and(
        eq(workflowSchedules.orgId, orgId),
        eq(workflowSchedules.workflowId, workflowId),
        eq(workflowSchedules.environment, environment)
      )
    )

  return schedule
}

// How many schedules an org has in this environment, counted against its share
// of the project's.
export async function countOrgSchedules(orgId: string, environment: string) {
  const [{ value }] = await getDb()
    .select({ value: count() })
    .from(workflowSchedules)
    .where(
      and(
        eq(workflowSchedules.orgId, orgId),
        eq(workflowSchedules.environment, environment)
      )
    )

  return value
}

// Records a workflow's schedule, replacing the one it had in this
// environment. The caller has already checked the workflow is the org's.
export async function saveWorkflowSchedule(
  schedule: Pick<
    WorkflowSchedule,
    | "orgId"
    | "workflowId"
    | "environment"
    | "preset"
    | "timezone"
    | "triggerScheduleId"
  >
) {
  const [saved] = await getDb()
    .insert(workflowSchedules)
    .values(schedule)
    .onConflictDoUpdate({
      target: [workflowSchedules.workflowId, workflowSchedules.environment],
      set: {
        preset: schedule.preset,
        timezone: schedule.timezone,
        triggerScheduleId: schedule.triggerScheduleId,
        active: true,
        updatedAt: new Date(),
      },
    })
    .returning()

  return saved
}

// Removes a workflow's schedule in this environment, if the workflow is this
// org's, and hands back what was removed.
export async function deleteWorkflowSchedule(
  orgId: string,
  workflowId: string,
  environment: string
) {
  const [removed] = await getDb()
    .delete(workflowSchedules)
    .where(
      and(
        eq(workflowSchedules.orgId, orgId),
        eq(workflowSchedules.workflowId, workflowId),
        eq(workflowSchedules.environment, environment)
      )
    )
    .returning()

  return removed
}

// The schedule a scheduled run was started by, found by the id Trigger.dev
// hands the run. Not scoped by org: the run comes from Trigger.dev, not from a
// person, and the org is what it finds out here.
export async function getScheduleForRun(triggerScheduleId: string) {
  const [schedule] = await getDb()
    .select()
    .from(workflowSchedules)
    .where(eq(workflowSchedules.triggerScheduleId, triggerScheduleId))

  return schedule
}

// Marks a schedule off, once Trigger.dev has been told to stop running it.
export async function deactivateWorkflowSchedule(triggerScheduleId: string) {
  await getDb()
    .update(workflowSchedules)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(workflowSchedules.triggerScheduleId, triggerScheduleId))
}

// The workflow's newest version: what a scheduled run executes.
export async function getLatestWorkflowVersion(
  orgId: string,
  workflowId: string
) {
  const [version] = await getDb()
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.orgId, orgId),
        eq(workflowVersions.workflowId, workflowId)
      )
    )
    .orderBy(desc(workflowVersions.createdAt))
    .limit(1)

  return version
}

export function listWorkflows(orgId: string) {
  return getDb()
    .select()
    .from(workflows)
    .where(eq(workflows.orgId, orgId))
    .orderBy(desc(workflows.createdAt))
}

export async function getWorkflow(orgId: string, id: string) {
  const [workflow] = await getDb()
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.orgId, orgId)))

  return workflow
}

export async function createWorkflow(orgId: string, name: string) {
  const [workflow] = await getDb()
    .insert(workflows)
    .values({ orgId, name })
    .returning()

  return workflow
}

export async function deleteWorkflow(orgId: string, id: string) {
  const [workflow] = await getDb()
    .delete(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.orgId, orgId)))
    .returning()

  return workflow
}
