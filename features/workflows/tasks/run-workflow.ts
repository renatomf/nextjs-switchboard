import toposort from "toposort"
import { logger, metadata, task, type TaskRunContext } from "@trigger.dev/sdk"
import { Stagehand } from "@browserbasehq/stagehand"
import { nodeExecutors } from "@/features/workflows/nodes/node-executors"
import type { NodeType } from "@/features/workflows/nodes/node-registry"
import { interpolate } from "@/features/workflows/lib/interpolate"
import {
  nextStepStatus,
  type StepEvent,
  type StepStatus,
} from "@/features/workflows/lib/step-status"
import { createBrowserSession } from "@/features/workflows/tasks/browser-session"
import {
  loadRunGraph,
  type RunWorkflowPayload,
} from "@/features/workflows/tasks/load-run-graph"
import {
  trackBrowserSession,
  trackExecution,
} from "@/features/workflows/tasks/execution-tracking"

// One node's progress and result, published under the run's "steps" metadata so
// the canvas can follow along while the run is still going and the run console
// can show what each step did once it is over.
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

// The Trigger.dev task the Run button fires. It loads the saved graph, works out
// what order the nodes should run in, and walks them, handing each node an
// executor from the registry.
export const runWorkflowTask = task({
  id: "run-workflow",
  // The project default is 3 attempts, which is wrong for this task: an attempt
  // re-runs the whole graph from the first node against a brand new Browserbase
  // session, so a failure in the last step pays for every step before it three
  // times over — three sessions, three times the model calls. The failures that
  // actually happen here (a bad instruction, a retired model, an exhausted quota)
  // are not the kind a retry fixes. One attempt, and the run reports what broke.
  retry: { maxAttempts: 1 },
  // Each hook moves the run's row in the executions table, and none of them
  // throws (see trackExecution). The app covers what they cannot see: it
  // writes the row when it triggers the run, and records a cancel itself,
  // since onCancel only fires for a run a worker is executing.
  onStartAttempt: ({ payload, ctx }) =>
    trackExecution(ctx.run.id, payload, "started"),
  onSuccess: ({ payload, ctx }) =>
    trackExecution(ctx.run.id, payload, "succeeded"),
  onFailure: ({ payload, ctx, error }) =>
    trackExecution(ctx.run.id, payload, "failed", error),
  //
  // The run's signal is what releases its browser on a cancel, but Trigger.dev
  // kills the worker soon after. Waiting on the run here holds that off (up to
  // 30 seconds, per the docs) until its finally has run. Its rejection is the
  // cancel itself, so there is nothing to report.
  onCancel: async ({ payload, ctx, runPromise }) => {
    await trackExecution(ctx.run.id, payload, "cancelled")
    await runPromise.catch(() => {})
  },
  // Both parameters typed: with the second one left bare, the function turns
  // context-sensitive, TypeScript stops inferring the payload type from it, and
  // every hook above sees the payload as void.
  run: async (
    payload: RunWorkflowPayload,
    { ctx, signal }: { ctx: TaskRunContext; signal: AbortSignal }
  ) => {
    // The graph this run was started with, not the workflow as it is now: see
    // loadRunGraph.
    const { nodes, edges } = await loadRunGraph(payload)
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

    logger.log(`Running workflow ${payload.workflowId}`, {
      versionId: payload.versionId,
      steps: order.length,
    })

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
        status: nodeExecutors[type] ? "pending" : "skipped",
      }
    })

    // Round-tripped through JSON rather than handed over as-is: metadata only
    // holds plain JSON, and a step now carries whatever its executor returned —
    // an SDK's class instance or an undefined field would be rejected by the
    // store. Serializing here is also what keeps the published copy detached
    // from the array below.
    const publishSteps = () => {
      metadata.set("steps", JSON.parse(JSON.stringify(steps)))
    }

    publishSteps()

    // Rebuilt rather than mutated, and that is load-bearing: metadata.set keeps
    // the array it is handed, then drops the next set as a no-op if the new value
    // deep-equals what it is holding. Editing a step in place edits the copy the
    // store holds too, so both sides always match and every update after the
    // first is silently discarded. A fresh array each time is what makes the
    // change visible to the diff, and so to the canvas.
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
      publishSteps()
    }

    // metadata.flush() returns without doing anything if a flush is already in
    // flight, and one runs on a background timer roughly every second. On the
    // failure path that silence is fatal: the run throws immediately after, so a
    // skipped flush means the "failed" step never leaves the worker. Retrying
    // past the in-flight window is what actually gets it to the canvas.
    const flushSteps = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await metadata.flush()
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }

    // The Browserbase session id, captured the moment the session opens so it can
    // be returned in the run's output — a panel reads it there to fetch the replay
    // once the run finishes and the recording is available.
    let browserbaseSessionId: string | undefined

    // Opens the run's Browserbase session. Only ever called through the browser
    // below, which decides when and makes sure the session is released.
    const openStagehand = async () => {
      const apiKey = process.env.BROWSERBASE_API_KEY
      if (!apiKey) throw new Error("BROWSERBASE_API_KEY is not set")

      // Overridable so a model can be swapped without a code change: model
      // availability moves fast, and a retired or overloaded one is a config
      // problem, not a code one. Prefer one of the models Stagehand's agent
      // types list: that list is what this default was picked from.
      const modelName =
        process.env.STAGEHAND_MODEL ?? "anthropic/claude-opus-4-8"
      // The model's own key, handed straight to whoever serves it, so it has to
      // match the provider in modelName: an override through STAGEHAND_MODEL
      // only works while it stays on anthropic/. Without a key the agent fails
      // with "API key not valid", which is what a keyless
      // google/gemini-3.5-flash did from 2026-09-08 until this was restored.
      const modelApiKey = process.env.CLAUDE_API_KEY

      const stagehand = new Stagehand({
        // Runs the session on Browserbase rather than a local Chrome, and routes
        // act/extract/observe through their API — which is also what makes the
        // run show up under the session's Stagehand tab in the dashboard.
        env: "BROWSERBASE",
        apiKey,
        model: modelApiKey ? { modelName, apiKey: modelApiKey } : modelName,
        // Pino's logging backend spawns a thread-stream worker (lib/worker.js)
        // that can't be resolved inside trigger.dev's bundled output. Disable it —
        // the option exists for exactly these minimal/bundled environments.
        disablePino: true,
      })

      await stagehand.init()
      browserbaseSessionId = stagehand.browserbaseSessionID
      logger.log("Started Browserbase session", { browserbaseSessionId })
      // On the execution too: it is what lets the replay route tie this
      // recording to an org.
      if (browserbaseSessionId) {
        await trackBrowserSession(ctx.run.id, browserbaseSessionId)
      }

      return stagehand
    }

    // The run owns one Browserbase session: opened on the first browser step,
    // reused by every later one so the recording spans the whole flow, and
    // released on the way out or the moment the run is cancelled.
    const browser = createBrowserSession({ open: openStagehand, signal })

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
        const executor = nodeExecutors[node.data.type]
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
        // Metadata is flushed on a background timer, so without forcing it here
        // "running" would be overwritten by "done" in memory before it was ever
        // pushed and the canvas would never show the step in flight.
        await metadata.flush()

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
          // A thrown run returns no output, so this flush is the only way the
          // step's final state ever reaches the canvas.
          await flushSteps()
          throw error
        }

        updateStep(id, "succeeded", {
          durationMs: Date.now() - startedAt,
          output: clampOutput(outputs[id]),
        })
      }
    } finally {
      // Closing releases the Browserbase session; there is no separate browser
      // handle in v3, so this one call is the whole cleanup. A no-op when a
      // cancel got there first.
      await browser.release()
    }

    // Returned as well as published: a completed run's output is guaranteed to
    // carry the finished state even if the last metadata flush is missed.
    //
    // outputs rides along so what each node actually produced — the page title, an
    // extraction — is readable after the run instead of only being interpolation
    // fuel that dies with the worker.
    //
    // browserbaseSessionId goes out here rather than in metadata on purpose: the
    // recording is only fetchable once the session has closed, which happens in
    // the finally above — so the earliest point it is any use to a replay panel is
    // the run's final output. undefined for a run whose graph never opened a
    // browser at all.
    return { steps, outputs, browserbaseSessionId }
  },
})
