import { describe, expect, it } from "vitest"

import { redactSecrets } from "./redact"

// The point is not to hide everything that looks unusual. An error nobody can
// read gets ignored, and then the next real failure hides in the noise. Each
// test below is either "this had to go" or "this had to stay".
describe("redactSecrets", () => {
  it("leaves an ordinary message alone", () => {
    const message = "The step took longer than 180 s and was stopped"

    expect(redactSecrets(message)).toBe(message)
  })

  describe("removes", () => {
    it("the credentials in a URL, keeping where it pointed", () => {
      const out = redactSecrets(
        "connect ECONNREFUSED postgres://admin:hunter2@db.example.com:5432/app"
      )

      expect(out).not.toContain("hunter2")
      expect(out).not.toContain("admin")
      expect(out).toContain("db.example.com:5432/app")
    })

    it("a token in a query string, keeping the parameter's name", () => {
      const out = redactSecrets(
        "GET https://api.example.com/v1/orders?token=abc123XYZsecretvalue failed"
      )

      expect(out).not.toContain("abc123XYZsecretvalue")
      expect(out).toContain("token=")
      expect(out).toContain("api.example.com/v1/orders")
    })

    it("every sensitive parameter in one URL, not just the first", () => {
      const out = redactSecrets(
        "https://x.test/a?api_key=AAAAAAAAAAAA&page=2&signature=BBBBBBBBBBBB"
      )

      expect(out).not.toContain("AAAAAAAAAAAA")
      expect(out).not.toContain("BBBBBBBBBBBB")
      // Not a secret, and losing it would cost the person debugging.
      expect(out).toContain("page=2")
    })

    it("a bearer token, keeping the scheme that says what it was", () => {
      const out = redactSecrets(
        "401 with header Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdef"
      )

      expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9abcdef")
      expect(out).toContain("Bearer")
    })

    it("a JSON web token wherever it appears", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"

      expect(redactSecrets(`session ${jwt} expired`)).not.toContain(jwt)
    })

    it.each([
      ["a webhook signing secret", "whsec_AbCdEfGhIjKlMnOpQrStUvWx"],
      ["an Anthropic key", "sk-ant-api03-AbCdEfGhIjKlMnOpQrSt"],
      ["a live secret key", "sk_live_AbCdEfGhIjKlMnOpQrSt"],
      ["a Trigger.dev key", "tr_prod_AbCdEfGhIjKlMnOpQrSt"],
      ["a GitHub token", "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
      ["an AWS access key id", "AKIAIOSFODNN7EXAMPLE"],
      ["a Google API key", "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q"],
    ])("%s by its prefix", (_, secret) => {
      expect(
        redactSecrets(`request failed with ${secret} rejected`)
      ).not.toContain(secret)
    })
  })

  describe("keeps", () => {
    // These are what someone actually needs to find the failure again. A
    // redactor that eats them is one people turn off.
    it("ids that are not secrets", () => {
      const message =
        "run run_abc123 of workflow b87f735e-3b94-4350-86f1-8327d0864eeb failed on node n_4"

      expect(redactSecrets(message)).toBe(message)
    })

    it("a plain URL with nothing sensitive in it", () => {
      const message =
        "navigation to https://example.com/products?page=2&sort=asc timed out"

      expect(redactSecrets(message)).toBe(message)
    })

    it("status codes and error codes", () => {
      const message =
        "HTTP error! status: 503, body: upstream unavailable (ECONNRESET)"

      expect(redactSecrets(message)).toBe(message)
    })
  })

  it("says something was taken out, rather than silently shortening", () => {
    expect(redactSecrets("token=abc123XYZsecretvalue")).toContain("[redacted]")
  })

  // Applied at two sinks, and a message can pass through both.
  it("changes nothing the second time it runs", () => {
    const once = redactSecrets("https://x.test/a?api_key=AAAAAAAAAAAA")

    expect(redactSecrets(once)).toBe(once)
  })

  it("handles an empty message", () => {
    expect(redactSecrets("")).toBe("")
  })
})
