import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

// Marks a secret for what it is, the way Stripe's does: anyone who finds one
// in a log or a screenshot knows what it opens and where to revoke it.
const SECRET_PREFIX = "whsec_"

// How far apart the sender's clock and ours may be. A request captured and
// sent again after this is refused, since its timestamp is signed along with
// the body and cannot be moved forward.
const TIME_WINDOW_MS = 5 * 60_000

// The one header shape accepted: the time it was signed, and the digest of
// that time with the body. Anything else is malformed rather than wrong, so a
// sender that signed the body alone gets told the shape is the problem.
const SIGNATURE = /^t=(\d{1,15}),v1=([0-9a-f]{64})$/

// A workflow's webhook secret: 32 random bytes, which is what the digest below
// is worth breaking.
export function createWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`
}

// The signature a sender puts on a request, as this app expects to read it.
// Also what the tests and the docs sign with, so the two never drift.
export function signWebhook({
  secret,
  body,
  at,
}: {
  secret: string
  // The raw body, byte for byte as it is sent: a re-serialized JSON would
  // change the digest.
  body: string
  at: Date
}): string {
  const seconds = Math.floor(at.getTime() / 1000)

  return `t=${seconds},v1=${digestOf({ secret, body, seconds })}`
}

type VerifiedSignature = { ok: true } | { ok: false; problem: string }

// Whether a request really came from whoever holds the workflow's secret, and
// recently. The digest is compared in constant time: comparing it like a
// string would let a caller learn it one character at a time, from how long
// each attempt takes.
export function verifyWebhookSignature({
  header,
  body,
  secret,
  now,
}: {
  header: string | undefined | null
  body: string
  secret: string
  now: Date
}): VerifiedSignature {
  const parts = typeof header === "string" ? SIGNATURE.exec(header) : null

  if (!parts) return { ok: false, problem: "Signature header is malformed" }

  const seconds = Number(parts[1])
  const signed = parts[2]

  if (Math.abs(now.getTime() - seconds * 1000) > TIME_WINDOW_MS) {
    return { ok: false, problem: "Signature is outside the time window" }
  }

  const expected = digestOf({ secret, body, seconds })

  // Both are 64 hex characters by now — the header's because the shape above
  // says so — so the buffers are the same length and timingSafeEqual can take
  // them.
  const matches = timingSafeEqual(
    Buffer.from(signed, "hex"),
    Buffer.from(expected, "hex")
  )

  return matches
    ? { ok: true }
    : { ok: false, problem: "Signature does not match" }
}

// The timestamp is signed with the body, which is what makes a captured
// request useless once its window has passed.
function digestOf({
  secret,
  body,
  seconds,
}: {
  secret: string
  body: string
  seconds: number
}): string {
  return createHmac("sha256", secret).update(`${seconds}.${body}`).digest("hex")
}
