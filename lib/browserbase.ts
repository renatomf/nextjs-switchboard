import "server-only"

import Browserbase from "@browserbasehq/sdk"

// The core Browserbase SDK, which is what the observability endpoints live on —
// session replays, recordings and logs. Stagehand drives sessions; it does not
// read them back.
//
// Server-only: this carries the secret API key, so importing it from a client
// component is a build error rather than a key shipped to the browser.
//
// Built on first use rather than at module scope, matching the other clients
// here: `next build` imports every route to collect page data, and build
// environments don't carry runtime secrets.
let client: Browserbase | undefined

export function getBrowserbase() {
  if (!client) {
    const apiKey = process.env.BROWSERBASE_API_KEY

    if (!apiKey) {
      throw new Error("BROWSERBASE_API_KEY is not set")
    }

    client = new Browserbase({ apiKey })
  }

  return client
}
