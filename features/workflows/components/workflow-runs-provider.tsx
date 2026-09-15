"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import * as Sentry from "@sentry/nextjs"
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"

import type { RunStep } from "@/features/workflows/engine/run-steps"
import type { runWorkflowTask } from "@/features/workflows/tasks/run-workflow"
import {
  createRunsTokenAction,
  getLiveRunIdsAction,
} from "@/features/workflows/actions"
import {
  isAbortFromReplacement,
  isRealtimeAuthError,
  isSubscriptionAbort,
  mayRefreshToken,
  TOKEN_REFRESH_INTERVAL_MS,
} from "@/features/workflows/lib/realtime-subscription"
import { isRealtimeViewStale } from "@/features/workflows/lib/run-liveness"
import { workflowRunTag } from "@/features/workflows/lib/run-ownership"
import {
  isRunLive,
  toWorkflowRun,
} from "@/features/workflows/lib/to-workflow-run"

type WorkflowRuns = ReturnType<
  typeof useRealtimeRunsWithTag<typeof runWorkflowTask>
>

type WorkflowRunsValue = Pick<WorkflowRuns, "runs" | "error">

// How often the canvas checks with the server while it shows a run as going.
const WATCHDOG_INTERVAL_MS = 10_000

// One subscription for the whole canvas. Every component that wants run state
// reads it from here instead of opening a socket of its own.
const WorkflowRunsContext = createContext<WorkflowRunsValue | null>(null)

interface WorkflowRunsProviderProps {
  workflowId: string
  // The first Trigger.dev public access token, scoped to read this workflow's
  // tag and minted on the server by createRunsReadToken. Replaced before it
  // expires (see below).
  publicAccessToken: string
  children: ReactNode
}

export function WorkflowRunsProvider({
  workflowId,
  publicAccessToken,
  children,
}: WorkflowRunsProviderProps) {
  // The realtime hooks keep their state in a cache shared by id, so it outlives
  // any one subscription: a fresh one starts from the runs the canvas already
  // shows instead of from none.
  const subscriptionId = `workflow-runs:${workflowId}`

  // Reads that shared state without subscribing. Subscribing is
  // <RunsSubscription>'s job, so it can be started over without this, or the
  // canvas below it, remounting.
  const { runs, error } = useRealtimeRunsWithTag<typeof runWorkflowTask>(
    workflowRunTag(workflowId),
    { id: subscriptionId, enabled: false }
  )

  // The token the subscription uses: the page's at first, then each one
  // refreshToken mints.
  const [accessToken, setAccessToken] = useState(publicAccessToken)

  // Bumped to start the subscription over, by remounting it.
  const [generation, setGeneration] = useState(0)

  // The error the subscription had when it was last started over. The shared
  // state keeps an error after its subscription is gone, and a fresh one never
  // clears it, so one from before the restart is set aside instead of shown.
  const [clearedError, setClearedError] = useState<Error>()
  const subscriptionError = error === clearedError ? undefined : error

  // What the panels show. An abort is never a lost connection to show: either
  // the provider replaced the subscription, or it is being started over
  // (see the effect that handles errors below).
  const shownError =
    subscriptionError && isSubscriptionAbort(subscriptionError)
      ? undefined
      : subscriptionError

  // Read by resubscribe rather than closed over, so resubscribe stays the same
  // function from one error to the next, and the timers that call it are not
  // reset by every error.
  const errorRef = useRef(error)
  useEffect(() => {
    errorRef.current = error
  }, [error])

  // When the subscription was last replaced, so the abort of the one it
  // replaced can be told apart (see isAbortFromReplacement).
  const lastResubscribedAt = useRef<number | undefined>(undefined)

  const resubscribe = useCallback(() => {
    lastResubscribedAt.current = Date.now()
    setClearedError(errorRef.current)
    setGeneration((current) => current + 1)
  }, [])

  // When the token was last replaced, so a token refused right after one was
  // minted is not answered with yet another (see mayRefreshToken).
  const lastRefreshedAt = useRef<number | undefined>(undefined)

  // Mints a fresh token on the server and subscribes again with it. A
  // subscription keeps the token it started with, so a new token only counts
  // from a new subscription.
  const refreshToken = useCallback(async () => {
    lastRefreshedAt.current = Date.now()
    const token = await createRunsTokenAction(workflowId)
    setAccessToken(token)
    resubscribe()
  }, [workflowId, resubscribe])

  // Tokens last an hour, and this subscription cannot renew its own:
  // Trigger.dev's React hooks only renew the token of their other streams,
  // never of a subscription to runs by tag. So the canvas replaces it well
  // before the hour is up.
  useEffect(() => {
    const interval = setInterval(() => {
      refreshToken().catch((refreshError: unknown) => {
        // The refusal below gets another go once the old token is turned down.
        Sentry.captureException(refreshError, {
          tags: { area: "trigger-realtime" },
          extra: { workflowId },
        })
      })
    }, TOKEN_REFRESH_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [refreshToken, workflowId])

  // The panels render this error as "Lost connection to the runs", which tells
  // the user but nobody else. A dropped subscription means the canvas stops
  // showing live progress, so it is worth seeing — unless it is a token turned
  // down, which is expected and answered with a new one.
  useEffect(() => {
    if (!subscriptionError) return

    if (isSubscriptionAbort(subscriptionError)) {
      // The subscription the provider just replaced, aborted on its way out:
      // nothing was lost, and the new one is already running.
      if (isAbortFromReplacement(lastResubscribedAt.current, Date.now())) {
        return
      }

      // Aborted by something else, and a subscription that fails stays
      // failed. Electric pauses the stream of a tab that goes into the
      // background by aborting its request, and a pause that lands while a
      // response is being read ends the subscription instead.
      Sentry.logger.warn("Realtime subscription aborted — resubscribing", {
        workflowId,
        reason: subscriptionError.message,
      })
      resubscribe()
      return
    }

    // A tab in the background can sleep past the hour: the browser holds its
    // timers back, and the old token is refused before the interval above
    // replaces it.
    if (
      isRealtimeAuthError(subscriptionError) &&
      mayRefreshToken(lastRefreshedAt.current, Date.now())
    ) {
      Sentry.logger.info("Realtime runs token refused — refreshing", {
        workflowId,
      })
      refreshToken().catch((refreshError: unknown) => {
        Sentry.captureException(refreshError, {
          tags: { area: "trigger-realtime" },
          extra: { workflowId },
        })
      })
      return
    }

    Sentry.logger.error("Realtime run subscription dropped", {
      workflowId,
      reason: subscriptionError.message,
    })
    Sentry.captureException(subscriptionError, {
      tags: { area: "trigger-realtime" },
      extra: { workflowId },
    })
  }, [subscriptionError, workflowId, refreshToken, resubscribe])

  // A string, so the watchdog below restarts when the runs shown as going
  // change, not on every update to their progress.
  const liveRunKey = useMemo(
    () =>
      runs
        .filter(isRunLive)
        .map((run) => run.id)
        .join(","),
    [runs]
  )

  // The watchdog. A subscription can go silent without an error: the canvas
  // then keeps a run as going long after it ended, with a spinner on a step
  // that finished and a Stop button for a run that is gone. While a run shows
  // as going, the server is asked whether it still is, and a canvas left
  // behind gets a fresh subscription, which comes back with every run as it
  // is now.
  useEffect(() => {
    if (!liveRunKey) return

    const shown = liveRunKey.split(",")
    // Set once this effect is done with: the realtime view moved on while the
    // server was being asked, so the answer is about a view no longer shown.
    let superseded = false

    async function check() {
      // A hidden tab has no one to show a run to; it checks on its way back.
      if (document.visibilityState !== "visible") return

      let stillLive: string[]
      try {
        stillLive = await getLiveRunIdsAction({ workflowId, runIds: shown })
      } catch {
        // Nothing to act on: the next check asks again.
        return
      }

      if (superseded || !isRealtimeViewStale(shown, stillLive)) return

      // Worth counting: how often a subscription goes silent is what says
      // whether this is a safety net or the thing holding the canvas up.
      Sentry.logger.warn("Realtime run view went stale — resubscribing", {
        workflowId,
        runIds: shown.join(", "),
      })
      resubscribe()
    }

    const interval = setInterval(check, WATCHDOG_INTERVAL_MS)

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void check()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      superseded = true
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [liveRunKey, workflowId, resubscribe])

  const value = useMemo(() => ({ runs, error: shownError }), [runs, shownError])

  return (
    <WorkflowRunsContext.Provider value={value}>
      <RunsSubscription
        key={generation}
        subscriptionId={subscriptionId}
        workflowId={workflowId}
        accessToken={accessToken}
      />
      {children}
    </WorkflowRunsContext.Provider>
  )
}

// The subscription behind the canvas's run state. It renders nothing: what it
// receives lands in the state shared under subscriptionId, where the provider
// reads it. Remounting it is how the provider starts it over, with a new token
// or after going silent.
function RunsSubscription({
  subscriptionId,
  workflowId,
  accessToken,
}: {
  subscriptionId: string
  workflowId: string
  accessToken: string
}) {
  // Runs are tagged workflow:<id> when the Run button triggers them, so the tag
  // is the handle on "every run of this workflow" without tracking run ids.
  useRealtimeRunsWithTag<typeof runWorkflowTask>(workflowRunTag(workflowId), {
    id: subscriptionId,
    accessToken,
    // The payload is just the ids we already have on the client — no reason to
    // pull it over the wire on every update. output and metadata are the point.
    skipColumns: ["payload"],
  })

  return null
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
