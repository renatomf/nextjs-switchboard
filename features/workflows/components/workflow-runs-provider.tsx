"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"

import type {
  RunStep,
  runWorkflowTask,
} from "@/features/workflows/tasks/run-workflow"

type WorkflowRuns = ReturnType<
  typeof useRealtimeRunsWithTag<typeof runWorkflowTask>
>

type WorkflowRunsValue = Pick<WorkflowRuns, "runs" | "error">

// One subscription for the whole canvas. Every component that wants run state
// reads it from here instead of opening a socket of its own.
const WorkflowRunsContext = createContext<WorkflowRunsValue | null>(null)

interface WorkflowRunsProviderProps {
  workflowId: string
  // A Trigger.dev public access token scoped to read this workflow's tag, minted
  // on the server: auth.createPublicToken({ scopes: { read: { tags: [...] } } }).
  publicAccessToken: string
  children: ReactNode
}

export function WorkflowRunsProvider({
  workflowId,
  publicAccessToken,
  children,
}: WorkflowRunsProviderProps) {
  // Runs are tagged workflow:<id> when the Run button triggers them, so the tag
  // is the handle on "every run of this workflow" without tracking run ids.
  const { runs, error } = useRealtimeRunsWithTag<typeof runWorkflowTask>(
    `workflow:${workflowId}`,
    {
      accessToken: publicAccessToken,
      // The payload is just the ids we already have on the client — no reason to
      // pull it over the wire on every update. output and metadata are the point.
      skipColumns: ["payload"],
    }
  )

  const value = useMemo(() => ({ runs, error }), [runs, error])

  return (
    <WorkflowRunsContext.Provider value={value}>
      {children}
    </WorkflowRunsContext.Provider>
  )
}

function useWorkflowRuns() {
  const value = useContext(WorkflowRunsContext)

  if (!value) {
    throw new Error(
      "useWorkflowRuns must be used inside a WorkflowRunsProvider"
    )
  }

  return value
}

// One run as the console reads it: everything Trigger.dev reports about the run
// itself, plus the steps resolved out of wherever that particular run left them.
export type WorkflowRun = WorkflowRuns["runs"][number] & {
  steps: RunStep[]
  isLive: boolean
  // The Browserbase session the run drove, for a panel to fetch the replay from.
  // undefined until the run finishes, and for any run that never opened a browser.
  browserbaseSessionId?: string
}

function toWorkflowRun(run: WorkflowRuns["runs"][number]): WorkflowRun {
  // The run carries its own booleans, derived from the same status mapping the
  // SDK uses, so the canvas never has to keep its own list of status strings in
  // sync with the ones Trigger.dev happens to send.
  const isLive = run.isQueued || run.isExecuting || run.isWaiting

  // The task returns its final steps on success, which is the authoritative
  // finished state; metadata is the live view while the run is still going (and
  // the only place a failed run's steps ever land, since it returns no output).
  const steps =
    run.output?.steps ?? (run.metadata?.steps as RunStep[] | undefined) ?? []

  // Output only — deliberately not read from live metadata. The session's
  // recording is not retrievable until the session closes, which the task does on
  // its way out, so an id surfaced mid-run would point at a replay that is not
  // there yet. Absent here means "no replay to offer", which is exactly what a
  // still-running run should read as.
  const browserbaseSessionId = run.output?.browserbaseSessionId

  // A failed run's own "failed" step write is the last thing it does before
  // throwing, and it can be lost — a dropped flush, a killed worker, a timeout.
  // The run status is what always arrives, and steps run strictly in order, so
  // the first step that never reached "done" is where the run stopped. Marking
  // it is what puts the red border on the node that actually broke.
  //
  // Skipped steps are passed over here: the trigger is never executed, so it is
  // never what a run broke on, and it sits ahead of every real step.
  //
  // A step repaired this way has no `error` of its own — the step never got to
  // write one — so a console showing it should fall back to the run's `error`.
  if (run.isFailed) {
    const stopped = steps.findIndex(
      (step) => step.status !== "done" && step.status !== "skipped"
    )

    if (stopped !== -1 && steps[stopped].status !== "failed") {
      const repaired = [...steps]
      repaired[stopped] = { ...steps[stopped], status: "failed" }

      return { ...run, steps: repaired, isLive, browserbaseSessionId }
    }
  }

  return { ...run, steps, isLive, browserbaseSessionId }
}

// Every run of this workflow, newest first, each with its steps resolved — what
// a run console lists and drills into.
export function useRunHistory(): {
  runs: WorkflowRun[]
  error: WorkflowRunsValue["error"]
} {
  const { runs, error } = useWorkflowRuns()

  return useMemo(
    () => ({
      // Sorted here rather than trusted from the subscription: the console reads
      // position as recency, and the first entry is also what the canvas paints
      // as the current run.
      runs: [...runs]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(toWorkflowRun),
      error,
    }),
    [runs, error]
  )
}

// The steps of the workflow's most recent run, and whether that run is still
// going — what the canvas needs to paint per-node progress.
export function useLatestRunSteps(): { steps: RunStep[]; isLive: boolean } {
  const { runs } = useRunHistory()

  return useMemo(() => {
    const latest = runs[0]

    if (!latest) return { steps: [], isLive: false }

    return { steps: latest.steps, isLive: latest.isLive }
  }, [runs])
}
