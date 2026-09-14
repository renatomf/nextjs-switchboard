import { logger, metadata, task, type TaskRunContext } from "@trigger.dev/sdk"
import { Stagehand } from "@browserbasehq/stagehand"
import {
  runSteps,
  type ProgressReporter,
} from "@/features/workflows/engine/run-steps"
import { nodeExecutors } from "@/features/workflows/nodes/node-executors"
import { createBrowserSession } from "@/features/workflows/tasks/browser-session"
import {
  loadRunGraph,
  type RunWorkflowPayload,
} from "@/features/workflows/tasks/load-run-graph"
import {
  trackBrowserSession,
  trackExecution,
} from "@/features/workflows/tasks/execution-tracking"

// The steps go out through the run's metadata, which the canvas and the run
// console follow in realtime.
const metadataReporter: ProgressReporter = {
  // Round-tripped through JSON rather than handed over as-is: metadata only
  // holds plain JSON, and a step carries whatever its executor returned — an
  // SDK's class instance or an undefined field would be rejected by the store.
  // Serializing here is also what keeps the published copy detached from the
  // walk's own.
  publish: (steps) => {
    metadata.set("steps", JSON.parse(JSON.stringify(steps)))
  },
  flush: () => metadata.flush(),
  // metadata.flush() returns without doing anything if a flush is already in
  // flight, and one runs on a background timer roughly every second. Right
  // before a run throws that silence is fatal: a skipped flush means the
  // step's final state never leaves the worker. Retrying past the in-flight
  // window is what actually gets it to the canvas.
  flushReliably: async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await metadata.flush()
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  },
}

// The Trigger.dev task the Run button fires. It loads the graph the run was
// started with and hands it to the engine (runSteps), wired to the real
// browser, the run's metadata and Trigger.dev's logger.
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
  // 30 seconds, per the docs) until its browser has been released. Its
  // rejection is the cancel itself, so there is nothing to report.
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
    const graph = await loadRunGraph(payload)

    logger.log(`Running workflow ${payload.workflowId}`, {
      versionId: payload.versionId,
    })

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

    const { steps, outputs } = await runSteps({
      graph,
      executors: nodeExecutors,
      browser,
      progress: metadataReporter,
      logger,
      signal,
    })

    // Returned as well as published: a completed run's output is guaranteed to
    // carry the finished state even if the last metadata flush is missed.
    //
    // outputs rides along so what each node actually produced — the page title, an
    // extraction — is readable after the run instead of only being interpolation
    // fuel that dies with the worker.
    //
    // browserbaseSessionId goes out here rather than in metadata on purpose: the
    // recording is only fetchable once the session has closed, which runSteps
    // does on its way out — so the earliest point it is any use to a replay panel
    // is the run's final output. undefined for a run whose graph never opened a
    // browser at all.
    return { steps, outputs, browserbaseSessionId }
  },
})
