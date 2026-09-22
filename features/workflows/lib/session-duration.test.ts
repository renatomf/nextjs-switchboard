import { describe, expect, it } from "vitest"

import { sessionSecondsOf } from "./session-duration"

describe("sessionSecondsOf", () => {
  it("measures a session that closed", () => {
    expect(
      sessionSecondsOf({
        startedAt: "2026-09-22T12:00:00Z",
        endedAt: "2026-09-22T12:02:30Z",
      })
    ).toBe(150)
  })

  // The run is settled but Browserbase has not finished closing the session.
  // Saying nothing leaves it for the next sweep; saying zero would record a
  // session that never ran.
  it("says nothing about a session with no end yet", () => {
    expect(sessionSecondsOf({ startedAt: "2026-09-22T12:00:00Z" })).toBeNull()
  })

  // The known case this exists for: the worker dies without cancelling, and
  // Browserbase keeps the session — and the billing — until its own timeout.
  // The worker's clock would have stopped at the crash; the session's does not.
  it("counts the time a lost session stayed open", () => {
    expect(
      sessionSecondsOf({
        startedAt: "2026-09-22T12:00:00Z",
        endedAt: "2026-09-22T12:05:00Z",
      })
    ).toBe(300)
  })

  it("drops a session that ended before it started", () => {
    expect(
      sessionSecondsOf({
        startedAt: "2026-09-22T12:00:10Z",
        endedAt: "2026-09-22T12:00:00Z",
      })
    ).toBeNull()
  })

  it("drops a stamp it cannot read", () => {
    expect(
      sessionSecondsOf({ startedAt: "not a date", endedAt: "also not" })
    ).toBeNull()
  })

  it("rounds to the nearest second", () => {
    expect(
      sessionSecondsOf({
        startedAt: "2026-09-22T12:00:00.000Z",
        endedAt: "2026-09-22T12:00:01.600Z",
      })
    ).toBe(2)
  })

  // A session that opened and closed at once is a real, billable zero — not
  // the absence of a reading, which is null.
  it("keeps a zero-length session as zero", () => {
    expect(
      sessionSecondsOf({
        startedAt: "2026-09-22T12:00:00Z",
        endedAt: "2026-09-22T12:00:00Z",
      })
    ).toBe(0)
  })
})
