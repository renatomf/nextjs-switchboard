import { SENTRY_BROWSER_DSN } from "@/lib/sentry-dsn"
import { sentryEnvelopeTarget } from "@/lib/sentry-tunnel"

// The browser SDK's tunnel (tunnel: "/monitoring" in instrumentation-client.ts).
// Events go out through the app's own origin, which ad blockers leave alone.
// Only the envelope is forwarded, never the browser's headers: the rewrite this
// replaces passed Clerk's ~9 KB of cookies along with it, and Sentry refused
// every request with 400 Request Header Or Cookie Too Large.
export async function POST(request: Request) {
  const envelope = new Uint8Array(await request.arrayBuffer())
  const target = sentryEnvelopeTarget(envelope, SENTRY_BROWSER_DSN)

  if (!target) {
    return new Response("Not an envelope for this project", { status: 400 })
  }

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
    })

    // Sentry's status goes back as is: a 429 is how the SDK learns to back off.
    return new Response(null, { status: upstream.status })
  } catch {
    return new Response(null, { status: 502 })
  }
}
