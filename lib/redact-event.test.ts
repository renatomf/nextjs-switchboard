import { describe, expect, it } from "vitest"

import { redactEvent } from "./redact-event"

describe("redactEvent", () => {
  describe("by the shape of the value", () => {
    it("cleans a secret out of a message, wherever it sits", () => {
      const out = redactEvent({
        exception: {
          values: [{ value: "rejected whsec_AbCdEfGhIjKlMnOpQrStUvWx" }],
        },
      }) as { exception: { values: { value: string }[] } }

      expect(out.exception.values[0].value).not.toContain("whsec_AbCdEf")
      expect(out.exception.values[0].value).toContain("rejected")
    })

    it("reaches into arrays and nested objects", () => {
      const out = redactEvent({
        breadcrumbs: [
          { data: { url: "https://x.test/a?token=AAAAAAAAAAAAAAAA" } },
        ],
      }) as { breadcrumbs: { data: { url: string } }[] }

      expect(out.breadcrumbs[0].data.url).not.toContain("AAAAAAAAAAAAAAAA")
      expect(out.breadcrumbs[0].data.url).toContain("x.test/a")
    })
  })

  describe("by the name of the field", () => {
    // includeLocalVariables puts local values on stack frames, and this
    // project has locals holding a plaintext secret — the webhook's, and the
    // vault's master key. A key in raw base64 matches no known prefix, so the
    // name is the only thing left to go on.
    it("empties a field whose name says it is a credential", () => {
      const out = redactEvent({
        vars: { secret: "nothing-here-looks-like-a-key", workflowId: "wf_1" },
      }) as { vars: { secret: string; workflowId: string } }

      expect(out.vars.secret).toBe("[redacted]")
      expect(out.vars.workflowId).toBe("wf_1")
    })

    it.each([
      "secret",
      "apiKey",
      "API_KEY",
      "credentialsKey",
      "password",
      "accessToken",
      "signature",
    ])("treats %s as a credential", (name) => {
      const out = redactEvent({ [name]: "value" }) as Record<string, string>

      expect(out[name]).toBe("[redacted]")
    })

    // The rule matches whole words, not substrings: a field called monkey is
    // not a key, and a redactor that eats ordinary fields gets turned off.
    it.each(["monkey", "keyboard", "tokenizer", "authorship"])(
      "leaves %s alone",
      (name) => {
        const out = redactEvent({ [name]: "value" }) as Record<string, string>

        expect(out[name]).toBe("value")
      }
    )
  })

  describe("keeps the event usable", () => {
    it("preserves structure and non-string values", () => {
      const event = {
        level: "error",
        timestamp: 1758556800,
        handled: false,
        tags: { runtime: "node" },
        empty: null,
      }

      expect(redactEvent(event)).toEqual(event)
    })

    it("does not go round in circles", () => {
      const event: Record<string, unknown> = { message: "hello" }
      event.self = event

      expect(() => redactEvent(event)).not.toThrow()
    })

    it("leaves values it cannot walk as they are", () => {
      const date = new Date("2026-09-22T00:00:00.000Z")
      const out = redactEvent({ when: date }) as { when: Date }

      expect(out.when).toBeInstanceOf(Date)
    })

    // It runs inside beforeSend, on the way out of a process that is already
    // reporting a problem. Throwing here would lose the report entirely.
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a bare string", "hello"],
      ["a number", 42],
    ])("never throws on %s", (_, value) => {
      expect(() => redactEvent(value)).not.toThrow()
    })

    it("changes nothing the second time it runs", () => {
      const once = redactEvent({ url: "https://x.test/a?api_key=AAAAAAAAAAAA" })

      expect(redactEvent(once)).toEqual(once)
    })
  })
})
