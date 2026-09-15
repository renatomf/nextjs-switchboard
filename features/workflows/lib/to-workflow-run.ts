import type { RunStep } from "@/features/workflows/engine/run-steps"

// The fields of a Trigger.dev run that toWorkflowRun reads, and nothing more.
// Typed this narrowly so it takes any run that carries them: the realtime
// hook's runs in the app, plain objects in tests.
export type RunSnapshot = {
  isQueued: boolean
  isExecuting: boolean
  isWaiting: boolean
  isCancelled: boolean
  isFailed: boolean
  output?: { steps?: RunStep[]; browserbaseSessionId?: string }
  metadata?: Record<string, unknown>
}

// Whether a run is still going: waiting for its turn, executing, or paused at a
// wait. The run carries its own booleans, derived from the same status mapping
// the SDK uses, so the canvas never has to keep its own list of status strings
// in sync with the ones Trigger.dev happens to send.
export function isRunLive(
  run: Pick<RunSnapshot, "isQueued" | "isExecuting" | "isWaiting">
): boolean {
  return run.isQueued || run.isExecuting || run.isWaiting
}

// One run as the console reads it: everything Trigger.dev reports about the run
// itself, plus the steps resolved out of wherever that particular run left them.
export function toWorkflowRun<Run extends RunSnapshot>(
  run: Run
): Run & { steps: RunStep[]; isLive: boolean; browserbaseSessionId?: string } {
  const isLive = isRunLive(run)

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

  // Stopping a run is not a failure and must not read as one. The task records
  // the step it was stopped on as cancelled, and two older shapes still arrive
  // here. Runs from before steps could say cancelled wrote the interrupted step
  // as failed, with the abort as its error, and a cancel write that got lost
  // leaves the step running. Both read as cancelled, without the abort's
  // message, since there is no error here to report. Everything behind the
  // step is pending: the run never reached it.
  //
  // Ahead of the repair below, which is deliberately not applied to a stopped
  // run: isFailed excludes CANCELED, so the two never both fire, and painting
  // the interrupted step red is exactly what this is undoing.
  if (run.isCancelled) {
    const stopped = steps.map((step) =>
      step.status === "failed" || step.status === "running"
        ? { ...step, status: "cancelled" as const, error: undefined }
        : step
    )

    return { ...run, steps: stopped, isLive, browserbaseSessionId }
  }

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
