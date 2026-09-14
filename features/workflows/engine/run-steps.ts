import toposort from "toposort"
import type { Stagehand } from "@browserbasehq/stagehand"

import { interpolate } from "@/features/workflows/lib/interpolate"
import {
  nextStepStatus,
  type StepEvent,
  type StepStatus,
} from "@/features/workflows/lib/step-status"
import type { NodeExecutor } from "@/features/workflows/nodes/node-executors"
import type { NodeType } from "@/features/workflows/nodes/node-registry"
import type { WorkflowGraph } from "@/lib/db/schema"

// One node's progress and result, published while the run is still going so
// the canvas can follow along, and read by the run console once it is over.
export type RunStep = {
  nodeId: string
  // Denormalized off the graph rather than looked up from it: a run is history,
  // and the node it ran may since have been retitled, retyped or deleted. This
  // is what the console renders the step's icon and title from.
  nodeType: NodeType
  title: string
  // The trigger is the one node that never executes. It starts "skipped" and
  // flips straight to "done" as the walk passes it, so a finished run reads as
  // completed all the way through — and it is never "pending" in between, which
  // is what keeps a failed run's repair from painting the entry point red.
  status: StepStatus
  // How long the executor took, in milliseconds. Set once the step settles, so
  // a failed step reports its time too.
  durationMs?: number
  // What the executor returned, clamped by clampOutput.
  output?: unknown
  // The message of whatever the executor threw, on a failed step only.
  error?: string
}

// The run's browser as the walk sees it: a step asks for it, and the run lets
// it go once, on the way out. createBrowserSession is the real one.
export type BrowserPort = {
  get: () => Promise<Stagehand>
  release: () => Promise<void>
}

// Where the steps go while the run is still going, so the canvas can follow.
export type ProgressReporter = {
  // Handed a fresh array on every change. A reporter may keep the one it is
  // given, so the walk never edits an array after passing it on.
  publish: (steps: RunStep[]) => void
  // Pushes what was published out now instead of on the reporter's own
  // schedule. Best effort: it is what lets a step be seen in flight.
  flush: () => Promise<void>
  // Pushes it out and makes sure it arrived. The run is about to throw, and a
  // thrown run returns no output, so this is the only way its last state lands.
  flushReliably: () => Promise<void>
}

export type RunLogger = {
  log: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
}

// Steps ride in the run's metadata, which is capped at 256KB for the whole run —
// and the SDK throws when a write goes over, which would take down the run it is
// only meant to be reporting on. A single page-text extract can exceed that on
// its own, so what a step carries is capped here. Nothing is lost: the full
// value is still in the run's `outputs` and on the trace timeline.
const OUTPUT_CHAR_CAP = 4_000
const ERROR_CHAR_CAP = 2_000

const clampOutput = (output: unknown) => {
  if (output === undefined) return undefined

  const json = JSON.stringify(output)
  // undefined for a value JSON cannot represent at all — hand back the tag
  // rather than a step that silently shows nothing.
  if (json === undefined) return String(output)

  return json.length <= OUTPUT_CHAR_CAP
    ? output
    : `${json.slice(0, OUTPUT_CHAR_CAP)}… (truncated)`
}

// Walks a workflow graph: works out the order the steps run in, and runs each
// one with the executor registered for its node type, reporting every change
// as it goes. Knows nothing of Trigger.dev or Browserbase: the task hands it a
// browser, a reporter and a logger, which is what makes the walk testable.
export async function runSteps({
  graph: { nodes, edges },
  executors,
  browser,
  progress,
  logger,
  signal,
}: {
  graph: WorkflowGraph
  executors: Partial<Record<NodeType, NodeExecutor>>
  browser: BrowserPort
  progress: ProgressReporter
  logger: RunLogger
  // Aborted when the run is cancelled.
  signal: AbortSignal
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // Run only connected nodes — anything touching an edge. Orphans dropped on
  // the canvas are skipped. toposort orders them and throws on a cycle.
  const connected = new Set(edges.flatMap((e) => [e.source, e.target]))
  const order = toposort
    .array(
      nodes.map((n) => n.id),
      edges.map((e) => [e.source, e.target])
    )
    .filter((id) => connected.has(id))

  logger.log("Steps planned", { steps: order.length })

  // Publish the whole plan up front so the canvas has every step from the
  // first frame. Every connected node is listed, including the ones with no
  // executor — the trigger, which is where the graph starts rather than work
  // the run does. Those start as "skipped" rather than "pending": the walk
  // marks them done the moment it reaches them, and until then they must not
  // be readable as a step that is waiting to run or as one a failed run
  // stopped on.
  let steps: RunStep[] = order.map((nodeId) => {
    const { type, title } = byId.get(nodeId)!.data

    return {
      nodeId,
      nodeType: type,
      title,
      status: executors[type] ? "pending" : "skipped",
    }
  })

  progress.publish(steps)

  // Rebuilt rather than mutated, and that is load-bearing: a reporter may keep
  // the array it is handed. Trigger.dev's metadata store does, then drops the
  // next set as a no-op if the new value deep-equals what it is holding, so an
  // edit in place would edit its copy too and every update after the first
  // would be silently discarded.
  //
  // Every change goes through the step state machine. A move the step cannot
  // take is a bug in the walk, not a reason to fail the run: it is logged and
  // dropped, so a settled step keeps saying how it ended.
  const updateStep = (
    nodeId: string,
    event: StepEvent,
    patch: Partial<Omit<RunStep, "status">> = {}
  ) => {
    const from = steps.find((step) => step.nodeId === nodeId)?.status
    const status = from && nextStepStatus(from, event)

    if (!status) {
      logger.warn("Step update refused", { nodeId, from, event })
      return
    }

    steps = steps.map((step) =>
      step.nodeId === nodeId ? { ...step, ...patch, status } : step
    )
    progress.publish(steps)
  }

  // What each node returned, keyed by node id, so later nodes can reference it
  // through {{ nodeId.path }} placeholders in their own fields. Nodes run in
  // dependency order, so anything a node points at is already in here.
  const outputs: Record<string, unknown> = {}

  try {
    for (const id of order) {
      // A Stop between two steps ends the walk here. Nothing starts once the
      // run is cancelled, not even a step that needs no browser, like sending
      // an email, and the steps not reached stay pending.
      signal.throwIfAborted()

      const node = byId.get(id)!
      logger.log(`Running step: ${node.data.title}`)
      const executor = executors[node.data.type]
      // The trigger, and anything else with no executor: no work to do and
      // nothing to return, so the walk marks it done as it goes past instead
      // of leaving it behind. Published right away, so the console shows the
      // run starting at the trigger and moving on rather than a first step
      // that reads as never run.
      if (!executor) {
        updateStep(id, "passed")
        continue
      }

      updateStep(id, "started")
      // Pushed now, or "running" would be overwritten by "done" before the
      // reporter ever sent it, and the canvas would never show the step in
      // flight.
      await progress.flush()

      const values = Object.fromEntries(
        Object.entries(node.data.values).map(([key, value]) => [
          key,
          interpolate(value, outputs),
        ])
      )

      // Timed around the executor alone, so a step's duration is the work it
      // did and not the interpolation or bookkeeping around it. Read on both
      // paths below, which is why it sits outside the try.
      const startedAt = Date.now()

      try {
        outputs[id] = await executor({ values, getStagehand: browser.get })
        // Logged per node, not just returned at the end. A run that throws
        // returns no output at all, so without this every result the run did
        // produce before it broke is lost. It also lands each result on the
        // trace timeline right after the Stagehand logs for the step that
        // produced it, which is where you read it when there is no session
        // recording to inspect.
        logger.log(`Step output: ${node.data.title}`, {
          nodeId: id,
          output: outputs[id],
        })
      } catch (error) {
        const durationMs = Date.now() - startedAt

        // A Stop reaches the step in flight as a throw like any other: the
        // browser it was driving is closed under it. It is recorded as what
        // it was, with no error, rather than as a failure the console would
        // have to explain away.
        if (signal.aborted) {
          updateStep(id, "cancelled", { durationMs })
        } else {
          updateStep(id, "failed", {
            durationMs,
            // A non-Error throw is rare but real (a rejected string, an
            // object from a native binding), and it is exactly the case where
            // losing the message leaves the console with nothing to show.
            error: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, ERROR_CHAR_CAP),
          })
        }
        // A thrown run returns no output, so this is the only way the step's
        // final state ever reaches the canvas.
        await progress.flushReliably()
        throw error
      }

      updateStep(id, "succeeded", {
        durationMs: Date.now() - startedAt,
        output: clampOutput(outputs[id]),
      })
    }
  } finally {
    // A no-op when a cancel got there first.
    await browser.release()
  }

  return { steps, outputs }
}
