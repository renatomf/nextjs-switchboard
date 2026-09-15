import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"

// The DSN the browser SDK reports with, when NEXT_PUBLIC_SENTRY_DSN is unset.
const DSN =
  "https://86ff20d901da2809a228a72a4bc3b5e8@o4510082957180928.ingest.us.sentry.io/4512051355385856"
const INGEST =
  "https://o4510082957180928.ingest.us.sentry.io/api/4512051355385856/envelope/"

const fetchToSentry = vi.fn()

beforeEach(() => {
  fetchToSentry.mockResolvedValue(new Response(null, { status: 200 }))
  vi.stubGlobal("fetch", fetchToSentry)
})

function tunnelRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/monitoring", {
    method: "POST",
    body,
    headers,
  })
}

const envelope = (dsn: string) =>
  `${JSON.stringify({ dsn })}\n{"type":"log"}\n{"items":[]}`

describe("POST /monitoring", () => {
  // The rewrite this replaces forwarded every browser header. Clerk's ~9 KB of
  // cookies made Sentry answer 400 Request Header Or Cookie Too Large, and no
  // browser event ever arrived.
  it("forwards the envelope to Sentry without the browser's cookies", async () => {
    const body = envelope(DSN)

    const response = await POST(
      tunnelRequest(body, { cookie: `__session=${"x".repeat(9_000)}` })
    )

    expect(response.status).toBe(200)
    const [url, init] = fetchToSentry.mock.calls[0]
    expect(url).toBe(INGEST)
    expect(new Headers(init.headers).has("cookie")).toBe(false)
    expect(new TextDecoder().decode(init.body)).toBe(body)
  })

  // Sentry's 429 is how the SDK learns to back off, so it has to reach it.
  it("hands Sentry's status back to the browser", async () => {
    fetchToSentry.mockResolvedValue(new Response(null, { status: 429 }))

    const response = await POST(tunnelRequest(envelope(DSN)))

    expect(response.status).toBe(429)
  })

  it("refuses another project's envelope without calling Sentry", async () => {
    const response = await POST(
      tunnelRequest(envelope(DSN.replace("4512051355385856", "999")))
    )

    expect(response.status).toBe(400)
    expect(fetchToSentry).not.toHaveBeenCalled()
  })
})
