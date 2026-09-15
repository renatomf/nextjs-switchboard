import { describe, expect, it } from "vitest"

import {
  isOverRateLimit,
  rateLimitWindowStart,
  retryAfterSeconds,
  WEBHOOK_CALLS_PER_WINDOW,
} from "./webhook-rate-limit"

// A webhook starts runs, and each run opens a browser and calls a model. The
// limit is counted per workflow, in fixed windows: the window a call belongs
// to is worked out here, and the counting itself is one row in Postgres, so
// two app instances share one count instead of allowing the limit each.
describe("rateLimitWindowStart", () => {
  it("is the start of the minute a call arrives in", () => {
    expect(rateLimitWindowStart(new Date("2026-09-15T12:34:56.789Z"))).toEqual(
      new Date("2026-09-15T12:34:00.000Z")
    )
  })

  it("is the same window for two calls in the same minute", () => {
    expect(rateLimitWindowStart(new Date("2026-09-15T12:34:00.000Z"))).toEqual(
      rateLimitWindowStart(new Date("2026-09-15T12:34:59.999Z"))
    )
  })

  it("is a new window once the minute turns", () => {
    expect(
      rateLimitWindowStart(new Date("2026-09-15T12:35:00.000Z"))
    ).not.toEqual(rateLimitWindowStart(new Date("2026-09-15T12:34:59.999Z")))
  })
})

describe("isOverRateLimit", () => {
  it("lets through every call up to the limit", () => {
    expect(isOverRateLimit(WEBHOOK_CALLS_PER_WINDOW)).toBe(false)
    expect(isOverRateLimit(1)).toBe(false)
  })

  // The count includes the call being answered, so one past the limit is the
  // first to be turned away.
  it("turns away the one past it", () => {
    expect(isOverRateLimit(WEBHOOK_CALLS_PER_WINDOW + 1)).toBe(true)
  })

  it("leaves room for a busy sender, not for a loop", () => {
    expect(WEBHOOK_CALLS_PER_WINDOW).toBeGreaterThanOrEqual(5)
    expect(WEBHOOK_CALLS_PER_WINDOW).toBeLessThanOrEqual(60)
  })
})

// What the refusal tells the sender to wait, in its Retry-After header.
describe("retryAfterSeconds", () => {
  it("counts the seconds left in the window", () => {
    expect(
      retryAfterSeconds(
        new Date("2026-09-15T12:34:10.000Z"),
        new Date("2026-09-15T12:34:00.000Z")
      )
    ).toBe(50)
  })

  // Never zero: a sender told to wait no time at all comes straight back.
  it("is at least a second, even at the very end of the window", () => {
    expect(
      retryAfterSeconds(
        new Date("2026-09-15T12:34:59.999Z"),
        new Date("2026-09-15T12:34:00.000Z")
      )
    ).toBe(1)
  })
})
