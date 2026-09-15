// The statuses of a run that has not settled yet: waiting for its turn,
// starting, executing, or paused at a wait. Every other status is how a run
// ended.
const LIVE_RUN_STATUSES: readonly string[] = [
  "PENDING_VERSION",
  "QUEUED",
  "DEQUEUED",
  "EXECUTING",
  "WAITING",
  "DELAYED",
]

export function isLiveRunStatus(status: string): boolean {
  return LIVE_RUN_STATUSES.includes(status)
}

// Whether the canvas has been left behind: it shows a run as going that the
// server has seen end. shown holds the runs the canvas shows as going, and
// stillLive the ones among them the server says still are. The other way round
// is not stale: a run the server knows of and the canvas does not show yet is
// the realtime view catching up.
export function isRealtimeViewStale(
  shown: readonly string[],
  stillLive: readonly string[]
): boolean {
  return shown.some((runId) => !stillLive.includes(runId))
}
