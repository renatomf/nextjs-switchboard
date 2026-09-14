// Where an execution is in its life. One row per Trigger.dev run, and the
// status only ever moves forward: once a run has ended, nothing that arrives
// later (a late hook, a second attempt, a cancel racing the worker) may
// rewrite how it ended.
export const EXECUTION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

// What the app and the worker report about a run.
export type ExecutionEvent = "started" | "succeeded" | "failed" | "cancelled"

const STATUS_AFTER: Record<ExecutionEvent, ExecutionStatus> = {
  started: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
}

// For each event, the statuses it may move an execution out of. The endings
// appear nowhere here, which is what makes them final. An ending is allowed
// straight from "queued" because the start can go unrecorded: its write can
// fail, and a run cancelled in the queue never starts at all.
const ALLOWED_FROM: Record<ExecutionEvent, readonly ExecutionStatus[]> = {
  started: ["queued"],
  succeeded: ["queued", "running"],
  failed: ["queued", "running"],
  cancelled: ["queued", "running"],
}

export function isTerminal(status: ExecutionStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled"
}

// The statuses an event applies to. The database uses this as the guard on
// its UPDATE, so a transition is checked and applied in one statement, with no
// read in between for a concurrent writer to slip into.
export function allowedFrom(event: ExecutionEvent): readonly ExecutionStatus[] {
  return ALLOWED_FROM[event]
}

// The status an execution moves to, or null when the event does not apply and
// the execution stays as it is.
export function nextStatus(
  current: ExecutionStatus,
  event: ExecutionEvent
): ExecutionStatus | null {
  return ALLOWED_FROM[event].includes(current) ? STATUS_AFTER[event] : null
}

export function statusAfter(event: ExecutionEvent): ExecutionStatus {
  return STATUS_AFTER[event]
}
