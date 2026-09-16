import { describe, expect, it } from "vitest"

import {
  isOverRunQuota,
  monthStart,
  RUN_QUOTAS,
  runQuotaFor,
  secondsUntilNextMonth,
} from "./run-quota"

// Runs are counted per calendar month, in UTC: everyone's month turns at the
// same instant, rather than each org's counting from whenever it signed up.
describe("monthStart", () => {
  it("is the first moment of the month a run happened in", () => {
    expect(monthStart(new Date("2026-09-16T23:45:12.345Z"))).toEqual(
      new Date("2026-09-01T00:00:00.000Z")
    )
  })

  it("is the same start for two runs in the same month", () => {
    expect(monthStart(new Date("2026-09-01T00:00:00.000Z"))).toEqual(
      monthStart(new Date("2026-09-30T23:59:59.999Z"))
    )
  })

  it("turns over at the first instant of the next month", () => {
    expect(monthStart(new Date("2026-10-01T00:00:00.000Z"))).toEqual(
      new Date("2026-10-01T00:00:00.000Z")
    )
  })
})

describe("runQuotaFor", () => {
  it("gives a paying org more runs than a free one", () => {
    expect(runQuotaFor(true)).toBeGreaterThan(runQuotaFor(false))
  })

  it("reads both quotas from one place", () => {
    expect(runQuotaFor(false)).toBe(RUN_QUOTAS.free)
    expect(runQuotaFor(true)).toBe(RUN_QUOTAS.pro)
  })

  // A quota of zero would lock everyone out, and one in the thousands would
  // stop being a ceiling on what a month can cost.
  it("leaves room to try the product, without leaving the cost open", () => {
    expect(RUN_QUOTAS.free).toBeGreaterThan(0)
    expect(RUN_QUOTAS.pro).toBeLessThanOrEqual(2000)
  })
})

// The count is of runs already started this month, so a run is refused once
// the count has reached the quota: the quota is how many a month holds, not
// how many may be asked for.
describe("isOverRunQuota", () => {
  it("lets a free org start its last allowed run", () => {
    expect(isOverRunQuota(RUN_QUOTAS.free - 1, false)).toBe(false)
  })

  it("turns away the one past the quota", () => {
    expect(isOverRunQuota(RUN_QUOTAS.free, false)).toBe(true)
  })

  it("holds a paying org to its own, larger quota", () => {
    expect(isOverRunQuota(RUN_QUOTAS.free, true)).toBe(false)
    expect(isOverRunQuota(RUN_QUOTAS.pro, true)).toBe(true)
  })

  it("lets a month start with nothing counted", () => {
    expect(isOverRunQuota(0, false)).toBe(false)
  })
})

// What a refused webhook call is told to wait: coming back before the month
// turns would only be refused again.
describe("secondsUntilNextMonth", () => {
  it("counts the seconds to the first instant of next month", () => {
    expect(secondsUntilNextMonth(new Date("2026-09-30T23:00:00.000Z"))).toBe(
      3600
    )
  })

  // December has to roll into January of the next year.
  it("rolls over the end of the year", () => {
    expect(secondsUntilNextMonth(new Date("2026-12-31T23:59:00.000Z"))).toBe(60)
  })

  // Never zero: a sender told to wait no time at all comes straight back.
  it("is at least a second at the very end of the month", () => {
    expect(secondsUntilNextMonth(new Date("2026-09-30T23:59:59.999Z"))).toBe(1)
  })
})
