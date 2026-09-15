import { describe, expect, it } from "vitest"

import { isRetryableStepError, StepTimeoutError } from "./step-errors"

// An error with the fields the SDKs set on theirs, the way they reach a step.
const withFields = (message: string, fields: Record<string, unknown>) =>
  Object.assign(new Error(message), fields)

describe("isRetryableStepError", () => {
  describe("tries again", () => {
    // The AI SDK's APICallError says for itself whether a call is worth
    // repeating, from the status the provider answered with.
    it("an error that says it is worth trying again", () => {
      expect(
        isRetryableStepError(withFields("Overloaded", { isRetryable: true }))
      ).toBe(true)
    })

    it.each([408, 429, 500, 502, 503, 504, 529])(
      "a %i answered by a service",
      (statusCode) => {
        expect(
          isRetryableStepError(withFields("Request failed", { statusCode }))
        ).toBe(true)
      }
    )

    // Stagehand's API client keeps the status in the message only.
    it("a 503 from Stagehand's API, which only says so in its message", () => {
      expect(
        isRetryableStepError(
          new Error('HTTP error! status: 503, body: {"error":"unavailable"}')
        )
      ).toBe(true)
    })

    it("a stream from Stagehand's API that ended part-way", () => {
      expect(
        isRetryableStepError(
          new Error("Stream ended without completion signal")
        )
      ).toBe(true)
    })

    it.each(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"])(
      "a connection that failed with %s",
      (code) => {
        expect(
          isRetryableStepError(withFields("connect failed", { code }))
        ).toBe(true)
      }
    )

    it.each(["fetch failed", "socket hang up"])(
      "a request that failed with %j",
      (message) => {
        expect(isRetryableStepError(new Error(message))).toBe(true)
      }
    )

    // What Gemini answered while it was overloaded, and what it arrives as.
    it("a model that is overloaded", () => {
      expect(
        isRetryableStepError(
          new Error(
            "This model is currently experiencing high demand. Please try again later."
          )
        )
      ).toBe(true)
    })

    // fetch wraps what actually went wrong: the reason is one level down.
    it("an error whose cause is worth trying again", () => {
      const cause = withFields("read ECONNRESET", { code: "ECONNRESET" })

      expect(
        isRetryableStepError(new Error("fetch to the API failed", { cause }))
      ).toBe(true)
    })
  })

  describe("does not try again", () => {
    // A retry costs the same model calls as the attempt that failed, and the
    // failures seen in this project (a bad instruction, a retired model, an
    // exhausted quota) were never fixed by one.
    it("an error it knows nothing about", () => {
      expect(isRetryableStepError(new Error("Something broke"))).toBe(false)
      expect(isRetryableStepError("quota exceeded")).toBe(false)
      expect(isRetryableStepError(undefined)).toBe(false)
    })

    it("an error that says it is not worth trying again", () => {
      expect(
        isRetryableStepError(
          withFields("Service Unavailable", {
            statusCode: 503,
            isRetryable: false,
          })
        )
      ).toBe(false)
    })

    it.each([400, 401, 402, 403, 404, 422])(
      "a %i answered by a service",
      (statusCode) => {
        expect(
          isRetryableStepError(withFields("Request failed", { statusCode }))
        ).toBe(false)
      }
    )

    // An exhausted Browserbase plan, as Stagehand reports it.
    it("a 402 from Stagehand's API", () => {
      expect(isRetryableStepError(new Error("Unknown error: 402"))).toBe(false)
    })

    it("an invalid API key", () => {
      expect(
        isRetryableStepError(
          new Error("API key not valid. Please pass a valid API key.")
        )
      ).toBe(false)
    })

    // The attempt that timed out may still be driving the page, and a second
    // one on the same browser would fight it for the page.
    it("a step that ran out of time", () => {
      expect(isRetryableStepError(new StepTimeoutError(60_000))).toBe(false)
    })
  })
})

describe("StepTimeoutError", () => {
  it("says how long the step was given, in seconds", () => {
    expect(new StepTimeoutError(90_000).message).toBe(
      "The step took longer than 90 s and was stopped"
    )
  })
})
