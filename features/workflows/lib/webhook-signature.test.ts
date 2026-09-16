import { describe, expect, it } from "vitest"

import {
  createWebhookSecret,
  signWebhook,
  verifyWebhookSignature,
} from "./webhook-signature"

const secret = "whsec_a_secret_for_tests"
const body = '{"event":"order.paid","id":"evt_1"}'
const now = new Date("2026-09-15T12:00:00Z")

const minutesBefore = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000)

describe("createWebhookSecret", () => {
  // Marked like Stripe's, so anyone who finds one in a log knows what it is
  // and where to revoke it.
  it("is a long random string, marked as a webhook secret", () => {
    expect(createWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{32,}$/)
  })

  it("is a different secret every time", () => {
    expect(createWebhookSecret()).not.toBe(createWebhookSecret())
  })
})

describe("signWebhook", () => {
  // The shape Stripe and GitHub use: the time it was signed, and the digest
  // of that time with the body.
  it("carries the time it was signed and a SHA-256 digest", () => {
    expect(signWebhook({ secret, body, at: now })).toMatch(
      /^t=\d{10},v1=[0-9a-f]{64}$/
    )
  })

  // The timestamp is signed along with the body, so a request captured today
  // cannot be replayed tomorrow with its own signature.
  it("signs the time along with the body", () => {
    expect(signWebhook({ secret, body, at: now })).not.toBe(
      signWebhook({ secret, body, at: minutesBefore(1) })
    )
  })
})

describe("verifyWebhookSignature", () => {
  const header = signWebhook({ secret, body, at: now })

  it("takes a signature it made itself", () => {
    expect(verifyWebhookSignature({ header, body, secret, now })).toEqual({
      ok: true,
    })
  })

  it("takes one signed a moment ago", () => {
    expect(
      verifyWebhookSignature({
        header: signWebhook({ secret, body, at: minutesBefore(4) }),
        body,
        secret,
        now,
      })
    ).toEqual({ ok: true })
  })

  it("refuses a body that changed after it was signed", () => {
    expect(
      verifyWebhookSignature({
        header,
        body: '{"event":"order.paid","id":"evt_2"}',
        secret,
        now,
      })
    ).toEqual({ ok: false, problem: "Signature does not match" })
  })

  it("refuses a signature made with another secret", () => {
    expect(
      verifyWebhookSignature({
        header: signWebhook({ secret: "whsec_someone_else", body, at: now }),
        body,
        secret,
        now,
      })
    ).toEqual({ ok: false, problem: "Signature does not match" })
  })

  // A request captured and sent again later.
  it("refuses a signature older than the window", () => {
    expect(
      verifyWebhookSignature({
        header: signWebhook({ secret, body, at: minutesBefore(6) }),
        body,
        secret,
        now,
      })
    ).toEqual({ ok: false, problem: "Signature is outside the time window" })
  })

  // A clock far ahead is as suspect as one far behind.
  it("refuses a signature from the future", () => {
    expect(
      verifyWebhookSignature({
        header: signWebhook({ secret, body, at: minutesBefore(-6) }),
        body,
        secret,
        now,
      })
    ).toEqual({ ok: false, problem: "Signature is outside the time window" })
  })

  it.each([
    ["nothing at all", undefined],
    ["an empty header", ""],
    ["another scheme", "sha256=0123456789abcdef"],
    ["no digest", "t=1789516800"],
    ["no time", "v1=0123456789abcdef"],
    ["a time that is not a number", "t=now,v1=0123456789abcdef"],
  ])("refuses %s", (_case, header) => {
    expect(verifyWebhookSignature({ header, body, secret, now })).toEqual({
      ok: false,
      problem: "Signature header is malformed",
    })
  })

  // A digest of the right shape but the wrong value: it must be compared in
  // full, in constant time, not by how far the two strings agree.
  it("refuses a digest of the right shape with the wrong value", () => {
    expect(
      verifyWebhookSignature({
        header: `t=${Math.floor(now.getTime() / 1000)},v1=${"0".repeat(64)}`,
        body,
        secret,
        now,
      })
    ).toEqual({ ok: false, problem: "Signature does not match" })
  })
})
