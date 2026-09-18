// How long the control holds a run it just started before letting go. A
// healthy subscription reports a new run within a second or two; this is far
// longer on purpose, because the cost of waiting too little is worse than the
// cost of waiting too long — see below.
export const SETTLE_TIMEOUT_MS = 15_000

export type ActiveRun = {
  // The run Stop has to reach, or null when the button should read Run.
  activeRunId: string | null
  // Whether this is a run we started and the subscription has not confirmed
  // yet. The caller uses it to arm the timeout above.
  settling: boolean
}

// Which run the Run/Stop control is holding. Two sources disagree during a
// short window and this decides between them: the realtime subscription, which
// is authoritative but late, and the run this button just started, which is
// immediate but unconfirmed.
//
// A just-started run is held until the subscription reports it. Without that,
// the button flashes back to Run in the gap — long enough for a second click
// to start a second run of the same workflow, which the whole one-run-per-
// workflow design exists to prevent.
//
// The live run wins when there is one: at most one run goes per workflow, so a
// run started in another tab, by a schedule or by a webhook is the one Stop
// must reach.
export function activeRunFor({
  liveRunId,
  startedId,
  knownRunIds,
}: {
  // What the realtime subscription reports as going, if anything.
  liveRunId: string | undefined
  // The run this control started, until it lets go of it.
  startedId: string | null
  // Every run the subscription knows about, live or finished. A started run
  // appearing here means the subscription has caught up.
  knownRunIds: readonly string[]
}): ActiveRun {
  const settling = startedId !== null && !knownRunIds.includes(startedId)

  return {
    // A started run that is known and not live has finished — handed back by
    // the lock, or over already — so the button goes back to Run rather than
    // waiting on something that is done.
    activeRunId: liveRunId ?? (settling ? startedId : null),
    settling,
  }
}
