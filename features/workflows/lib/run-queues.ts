// The queues a run can go on, one per plan, and how many runs of one org each
// lets execute at a time. Pure, so the action can pick a queue without pulling
// in the worker: the task declares the queues from these same values.
export const RUN_QUEUES = {
  free: { name: "runs-free", concurrencyLimit: 1 },
  pro: { name: "runs-pro", concurrencyLimit: 3 },
} as const

// Where a run goes: its plan's queue, with its org as the concurrency key,
// which gives every org its own copy of that queue. A run past the limit waits
// as queued instead of failing.
export function runQueueFor({
  orgId,
  isPro,
}: {
  orgId: string
  isPro: boolean
}) {
  return {
    queue: (isPro ? RUN_QUEUES.pro : RUN_QUEUES.free).name,
    concurrencyKey: orgId,
  }
}
