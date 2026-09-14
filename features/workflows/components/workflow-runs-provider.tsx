"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react"
import * as Sentry from "@sentry/nextjs"
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"

import type {
  RunStep,
  runWorkflowTask,
} from "@/features/workflows/tasks/run-workflow"
import { toWorkflowRun } from "@/features/workflows/lib/to-workflow-run"

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

  // The panels render this error as "Lost connection to the runs", which tells
  // the user but nobody else. A dropped subscription means the canvas stops
  // showing live progress, so it is worth seeing — an expired public token or a
  // socket that will not reconnect both land here.
  useEffect(() => {
    if (!error) return

    Sentry.logger.error("Realtime run subscription dropped", {
      workflowId,
      reason: error.message,
    })
    Sentry.captureException(error, {
      tags: { area: "trigger-realtime" },
      extra: { workflowId },
    })
  }, [error, workflowId])

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

// The run that is still going, if there is one. A workflow has at most one live
// run at a time, so this is the run a Stop button has to cancel.
export function useLiveRun(): WorkflowRun | undefined {
  const { runs } = useRunHistory()

  return useMemo(() => runs.find((run) => run.isLive), [runs])
}
