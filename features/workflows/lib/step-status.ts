// Every status a step of a run can be in, and the only ways it moves. The run
// task writes each step through nextStepStatus, so a step records what
// actually happened to it instead of being repaired from the run's status
// after the fact.
export const STEP_STATUSES = [
  "pending",
  "running",
  "done",
  "failed",
  "cancelled",
  // The trigger: where the run starts, not work it does.
  "skipped",
] as const

export type StepStatus = (typeof STEP_STATUSES)[number]

export const STEP_EVENTS = [
  "started",
  "retried",
  "succeeded",
  "failed",
  "cancelled",
  "passed",
] as const

export type StepEvent = (typeof STEP_EVENTS)[number]

// Each event, the one status it moves a step out of, and where it lands.
const TRANSITIONS: Record<StepEvent, { from: StepStatus; to: StepStatus }> = {
  started: { from: "pending", to: "running" },
  // A failed attempt that earns another: the step keeps running, on to its
  // next attempt.
  retried: { from: "running", to: "running" },
  succeeded: { from: "running", to: "done" },
  failed: { from: "running", to: "failed" },
  cancelled: { from: "running", to: "cancelled" },
  // The walk goes past the trigger on its way to the first real step.
  passed: { from: "skipped", to: "done" },
}

// Where an event moves a step, or null when the step cannot take it: a settled
// step never moves, and a step cannot finish before it has started.
export function nextStepStatus(
  current: StepStatus,
  event: StepEvent
): StepStatus | null {
  const { from, to } = TRANSITIONS[event]

  return current === from ? to : null
}
