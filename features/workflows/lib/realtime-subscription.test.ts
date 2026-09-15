import { describe, expect, it } from "vitest"

import {
  isAbortFromReplacement,
  isRealtimeAuthError,
  isSubscriptionAbort,
  mayRefreshToken,
  TOKEN_REFRESH_INTERVAL_MS,
} from "./realtime-subscription"

// What the realtime subscription fails with: Electric's FetchError, which
// carries the status Trigger.dev answered with.
const fetchError = (status: number, message = `HTTP Error ${status}`) =>
  Object.assign(new Error(message), { name: "FetchError", status })

describe("isRealtimeAuthError", () => {
  it.each([401, 403])("is a token turned down for a %i", (status) => {
    expect(isRealtimeAuthError(fetchError(status))).toBe(true)
  })

  it.each([400, 404, 500, 503])("is not one for a %i", (status) => {
    expect(isRealtimeAuthError(fetchError(status))).toBe(false)
  })

  it("is not one for an error with no status", () => {
    expect(isRealtimeAuthError(new Error("Failed to fetch"))).toBe(false)
    expect(isRealtimeAuthError(undefined)).toBe(false)
    expect(isRealtimeAuthError("401")).toBe(false)
  })
})

describe("isSubscriptionAbort", () => {
  // What production showed as "Lost connection to the runs: The user aborted
  // a request." Electric wraps an abort that lands while it reads a response
  // in a FetchError carrying that response's status, a 200.
  it("is an abort Electric wrapped as a FetchError", () => {
    expect(
      isSubscriptionAbort(fetchError(200, "The user aborted a request."))
    ).toBe(true)
  })

  it("is the abort fetch itself fails with", () => {
    expect(
      isSubscriptionAbort(
        new DOMException("The operation was aborted.", "AbortError")
      )
    ).toBe(true)
  })

  it("is not a failure Trigger.dev answered with", () => {
    expect(isSubscriptionAbort(fetchError(500))).toBe(false)
    expect(isSubscriptionAbort(fetchError(401, "Request aborted: 401"))).toBe(
      false
    )
  })

  it("is not a connection that failed", () => {
    expect(isSubscriptionAbort(new TypeError("Failed to fetch"))).toBe(false)
    expect(isSubscriptionAbort(undefined)).toBe(false)
  })
})

// Replacing a subscription aborts the old one, whose abort then lands in the
// state it shares with the new one. It arrives within moments of the
// replacement; an abort long after it is a subscription something else ended.
describe("isAbortFromReplacement", () => {
  const now = 1_000_000_000

  it("is when the subscription was replaced a moment ago", () => {
    expect(isAbortFromReplacement(now - 300, now)).toBe(true)
  })

  it("is not when the last replacement was a while ago", () => {
    expect(isAbortFromReplacement(now - 60_000, now)).toBe(false)
  })

  it("is not when the subscription was never replaced", () => {
    expect(isAbortFromReplacement(undefined, now)).toBe(false)
  })
})

// A token refused right after a new one was minted is not an expired token,
// and minting yet another would only loop.
describe("mayRefreshToken", () => {
  const now = 1_000_000_000

  it("may when the token was never replaced", () => {
    expect(mayRefreshToken(undefined, now)).toBe(true)
  })

  it("may not within a minute of the last replacement", () => {
    expect(mayRefreshToken(now - 10_000, now)).toBe(false)
  })

  it("may again a minute after", () => {
    expect(mayRefreshToken(now - 60_000, now)).toBe(true)
  })
})

describe("TOKEN_REFRESH_INTERVAL_MS", () => {
  // Tokens last an hour. A token replaced on the hour would already be
  // refused by then.
  it("replaces the token well before its hour is up", () => {
    expect(TOKEN_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(50 * 60_000)
  })
})
