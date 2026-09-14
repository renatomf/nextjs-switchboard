import { describe, expect, it } from "vitest"

import { RUN_QUEUES, runQueueFor } from "./run-queues"

describe("runQueueFor", () => {
  it("sends a free org's run to the free queue, keyed by the org", () => {
    expect(runQueueFor({ orgId: "org_a", isPro: false })).toEqual({
      queue: "runs-free",
      concurrencyKey: "org_a",
    })
  })

  it("sends a pro org's run to the pro queue, keyed by the org", () => {
    expect(runQueueFor({ orgId: "org_a", isPro: true })).toEqual({
      queue: "runs-pro",
      concurrencyKey: "org_a",
    })
  })

  // The task defaults to the free queue, so a run triggered without one lands
  // on the tighter limit instead of an unbounded one.
  it("holds a free org to fewer concurrent runs than a pro one", () => {
    expect(RUN_QUEUES.free.concurrencyLimit).toBeLessThan(
      RUN_QUEUES.pro.concurrencyLimit
    )
  })
})
