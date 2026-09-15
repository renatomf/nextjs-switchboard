import { describe, expect, it } from "vitest"

import { sentryEnvelopeTarget } from "./sentry-tunnel"

const DSN =
  "https://86ff20d901da2809a228a72a4bc3b5e8@o4510082957180928.ingest.us.sentry.io/4512051355385856"

const encode = (text: string) => new TextEncoder().encode(text)

function envelope(header: unknown, rest = '{"type":"log"}\n{}') {
  return encode(`${JSON.stringify(header)}\n${rest}`)
}

describe("sentryEnvelopeTarget", () => {
  it("sends an envelope for this project to Sentry's envelope endpoint", () => {
    expect(sentryEnvelopeTarget(envelope({ dsn: DSN }), DSN)).toBe(
      "https://o4510082957180928.ingest.us.sentry.io/api/4512051355385856/envelope/"
    )
  })

  // Replay segments arrive compressed: only the header line is text, and the
  // bytes after it must not stop the envelope from being read.
  it("reads the header of an envelope whose body is binary", () => {
    const header = encode(`${JSON.stringify({ dsn: DSN })}\n`)
    const binary = new Uint8Array([0x78, 0x9c, 0xff, 0x00, 0x0a, 0xfe])

    expect(
      sentryEnvelopeTarget(new Uint8Array([...header, ...binary]), DSN)
    ).toBe(
      "https://o4510082957180928.ingest.us.sentry.io/api/4512051355385856/envelope/"
    )
  })

  // The tunnel forwards only to this project, so it cannot be used as an open
  // proxy into anyone else's Sentry.
  it("refuses an envelope for another project", () => {
    const other = DSN.replace("4512051355385856", "999")

    expect(sentryEnvelopeTarget(envelope({ dsn: other }), DSN)).toBeNull()
  })

  it("refuses an envelope aimed at another host", () => {
    const elsewhere = DSN.replace("ingest.us.sentry.io", "attacker.example")

    expect(sentryEnvelopeTarget(envelope({ dsn: elsewhere }), DSN)).toBeNull()
  })

  it("refuses a body that is not a Sentry envelope", () => {
    expect(sentryEnvelopeTarget(encode("not json\n{}"), DSN)).toBeNull()
    expect(sentryEnvelopeTarget(envelope({ event_id: "abc" }), DSN)).toBeNull()
    expect(sentryEnvelopeTarget(new Uint8Array(), DSN)).toBeNull()
  })
})
