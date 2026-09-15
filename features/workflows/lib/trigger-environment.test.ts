import { describe, expect, it } from "vitest"

import { triggerEnvironmentOf } from "./trigger-environment"

// Which Trigger.dev environment a secret key belongs to, read off its prefix.
// What a schedule's deduplication key is scoped by, since development and
// production share one database.
describe("triggerEnvironmentOf", () => {
  it.each([
    ["tr_dev_0123456789abcdef", "dev"],
    ["tr_prod_0123456789abcdef", "prod"],
    ["tr_stg_0123456789abcdef", "stg"],
  ])("reads %s as %s", (secretKey, environment) => {
    expect(triggerEnvironmentOf(secretKey)).toBe(environment)
  })

  // The result ends up in a deduplication key on Trigger.dev and in logs, so
  // no part of the secret may reach it.
  it("gives nothing of the secret away", () => {
    expect(triggerEnvironmentOf("tr_prod_SECRETPART")).not.toContain("SECRET")
  })

  it("refuses a missing key", () => {
    expect(() => triggerEnvironmentOf(undefined)).toThrow(
      "TRIGGER_SECRET_KEY is not set"
    )
  })

  it("refuses a key that is not a Trigger.dev secret key", () => {
    expect(() => triggerEnvironmentOf("sk_live_123")).toThrow(
      "TRIGGER_SECRET_KEY is not a Trigger.dev secret key"
    )
  })
})
