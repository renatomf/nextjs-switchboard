import { APIError } from "@browserbasehq/sdk"
import * as Sentry from "@sentry/nextjs"
import { auth } from "@clerk/nextjs/server"
import type { NextRequest } from "next/server"

import { PRO_PLAN } from "@/lib/billing"
import { getBrowserbase } from "@/lib/browserbase"
import { getExecutionBySession } from "@/features/workflows/data"

// What Browserbase serves an HLS media playlist as, and what the SDK asks for.
// hls.js ignores the content type, but Safari's native player — which is what
// plays this on iOS, where MediaSource isn't available — does not.
const PLAYLIST_CONTENT_TYPE = "application/vnd.apple.mpegurl"

// Proxies a session's replay playlist. The retrieval needs the secret API key,
// so it can't happen in the browser — but only the manifest has to come through
// here: the segment URLs inside it are absolute, pre-signed CDN links, which the
// player fetches directly.
//
// Those signatures expire about six hours out, which is why nothing here may be
// cached — a cached manifest is a manifest full of dead links. Re-requesting is
// what mints fresh ones.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  // Signed in with an active org first. Whether the session is that org's is
  // checked further down, against the run that opened it.
  const { userId, orgId, has } = await auth()

  if (!userId || !orgId) {
    return new Response("Unauthorized", { status: 401 })
  }

  Sentry.getIsolationScope().setAttributes({
    route: "GET /api/replays/[sessionId]",
    userId,
    orgId,
  })

  // Replay is a paid feature, and this route is the only way to reach a
  // recording — the playlist needs the secret key, so nothing downstream can
  // mint one without coming through here. The console locks the Replay row for
  // a non-pro org, but that is presentation; this is the enforcement.
  //
  // 403 rather than the 202 this route uses for "not ready": the recording is
  // fine and the caller simply isn't entitled to it, so a poller should give up
  // rather than wait for something that will never change on its own.
  if (!has({ plan: PRO_PLAN })) {
    Sentry.logger.warn("Replay blocked by plan", {
      orgId,
      requiredPlan: PRO_PLAN,
    })

    return Response.json(
      { error: "Session replay requires the Pro plan" },
      { status: 403 }
    )
  }

  const { sessionId } = await params

  // The session has to belong to one of this org's runs. The id alone proves
  // nothing: anyone signed in who learned one could otherwise watch another
  // org's recording. Not this org's and never recorded get the same 404, so
  // a probe learns nothing, and a 404 rather than the 202 below because
  // waiting will not change the answer.
  const execution = await getExecutionBySession(orgId, sessionId)

  if (!execution) {
    Sentry.logger.warn("Replay refused — session not this org's", {
      orgId,
      sessionId,
    })

    return new Response("Replay not found", { status: 404 })
  }

  try {
    const browserbase = getBrowserbase()

    // A session records one replay per page it opened, so the metadata call is
    // what turns a session id into something addressable. It doubles as the
    // readiness probe: while the recording is still being processed there is no
    // metadata to return yet.
    const replay = await browserbase.sessions.replays.retrieve(sessionId)

    // Defaults to the first page — the tab the run started in. A session that
    // opened more than one has the rest addressable by page id, which the
    // metadata lists.
    const requestedPage = request.nextUrl.searchParams.get("page")
    const page = requestedPage
      ? replay.pages.find((candidate) => candidate.pageId === requestedPage)
      : replay.pages[0]

    if (!page) {
      // No pages at all means the recording exists but isn't assembled yet —
      // the same "come back later" as a 404 below. A page id that was asked for
      // by name and isn't there is a different thing, and says so.
      return requestedPage
        ? new Response(`Session ${sessionId} has no page ${requestedPage}`, {
            status: 404,
          })
        : Response.json({ status: "pending" }, { status: 202 })
    }

    const playlist = await browserbase.sessions.replays.retrievePage(
      sessionId,
      page.pageId
    )

    Sentry.logger.info("Session replay served", {
      orgId,
      sessionId,
      pageCount: replay.pages.length,
    })

    return new Response(await playlist.text(), {
      headers: {
        "content-type": PLAYLIST_CONTENT_TYPE,
        "cache-control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof APIError) {
      // Browserbase answers 404 until the recording is ready, so that is passed
      // through as "not yet" rather than "not there" and the caller polls.
      //
      // It says the same thing about a session that will never have a recording
      // — one that was never recorded, or an id that doesn't exist — so a poller
      // has to give up on its own clock; this route can't tell it to.
      if (error.status === 404) {
        return Response.json({ status: "pending" }, { status: 202 })
      }

      // Passed through rather than swallowed: the project's replay quota is 120
      // requests a minute across everyone, and a caller that sees this should
      // slow down instead of treating it as a failed replay.
      if (error.status === 429) {
        // The project-wide replay quota, not this caller's problem to fix —
        // which is exactly why it should be visible when it starts happening.
        Sentry.logger.warn("Replay quota exhausted", { orgId, sessionId })

        return Response.json({ status: "rate-limited" }, { status: 429 })
      }
    }

    throw error
  }
}
