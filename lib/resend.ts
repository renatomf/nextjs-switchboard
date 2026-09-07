import "server-only"

import { Resend } from "resend"

// The Resend API has no CORS support by design, so this client is server-only:
// importing it from a client component is a build error rather than a leaked key.
//
// Built on first use rather than at module scope, so `next build` — which
// imports every route to collect page data without runtime secrets — doesn't
// need RESEND_API_KEY to be present.
let client: Resend | undefined

export function getResend() {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY

    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set")
    }

    client = new Resend(apiKey)
  }

  return client
}
