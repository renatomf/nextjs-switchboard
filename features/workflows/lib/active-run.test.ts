import { describe, expect, it } from "vitest"

import { activeRunFor, SETTLE_TIMEOUT_MS } from "./active-run"

// The Run button turns into Stop while a run is going, so "which run is this
// button holding" has to be right in a window where two sources disagree: the
// realtime subscription, which is authoritative but late, and the run this
// button just started, which is immediate but unconfirmed.
describe("activeRunFor", () => {
  it("holds nothing when no run is going and none was started", () => {
    expect(
      activeRunFor({ liveRunId: undefined, startedId: null, knownRunIds: [] })
    ).toEqual({ activeRunId: null, settling: false })
  })

  it("holds the run the subscription reports as live", () => {
    expect(
      activeRunFor({
        liveRunId: "run_live",
        startedId: null,
        knownRunIds: ["run_live"],
      })
    ).toEqual({ activeRunId: "run_live", settling: false })
  })

  // The gap this exists for: without holding the just-started run, the button
  // flashes back to Run — long enough for a second click to start a second run
  // of the same workflow.
  it("holds a run it just started, before the subscription reports it", () => {
    expect(
      activeRunFor({
        liveRunId: undefined,
        startedId: "run_new",
        knownRunIds: [],
      })
    ).toEqual({ activeRunId: "run_new", settling: true })
  })

  it("stops settling once the subscription reports that run", () => {
    expect(
      activeRunFor({
        liveRunId: "run_new",
        startedId: "run_new",
        knownRunIds: ["run_new"],
      })
    ).toEqual({ activeRunId: "run_new", settling: false })
  })

  // A run that was handed back already finished, or finished between the
  // click and the subscription catching up. It is known and not live, so the
  // button goes back to Run rather than waiting on something that is over.
  it("lets go of a started run that is known and no longer live", () => {
    expect(
      activeRunFor({
        liveRunId: undefined,
        startedId: "run_done",
        knownRunIds: ["run_done"],
      })
    ).toEqual({ activeRunId: null, settling: false })
  })

  // One run per workflow, so a run started elsewhere — another tab, a
  // schedule, a webhook — is the one Stop must reach.
  it("prefers the live run over one this button started", () => {
    expect(
      activeRunFor({
        liveRunId: "run_elsewhere",
        startedId: "run_new",
        knownRunIds: [],
      })
    ).toMatchObject({ activeRunId: "run_elsewhere" })
  })

  it("ignores other runs in the history", () => {
    expect(
      activeRunFor({
        liveRunId: undefined,
        startedId: "run_new",
        knownRunIds: ["run_old", "run_older"],
      })
    ).toEqual({ activeRunId: "run_new", settling: true })
  })
})

// A run that never reaches the subscription — a dropped stream, an expired
// token — must not leave the button on Stop for good.
describe("SETTLE_TIMEOUT_MS", () => {
  it("waits longer than a healthy subscription takes, and not much longer", () => {
    expect(SETTLE_TIMEOUT_MS).toBeGreaterThan(5_000)
    expect(SETTLE_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
  })
})
