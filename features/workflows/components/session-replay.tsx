"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect, useRef, useState } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

// How often to ask whether the recording is ready, and how long to keep asking.
//
// The deadline is not optional. Browserbase answers a session that is still
// processing and a session that will never have a recording with the same 404,
// so the route reports both as "pending" — nothing downstream can distinguish
// them, and without a clock of its own this would poll for as long as the panel
// stayed open. Giving up and saying so is the honest end state.
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 180_000

type ReplayState =
  | { status: "pending" }
  | { status: "ready" }
  | { status: "error"; message: string }

interface SessionReplayProps {
  // The Browserbase session to play back. A run carries this on its output once
  // it has finished.
  sessionId: string
  className?: string
}

// Plays back a Browserbase session recording. The playlist comes from our own
// proxy route rather than Browserbase directly — retrieving it needs the secret
// key — and is not there the moment the session closes, so this polls until it
// is and then hands it to hls.js.
export function SessionReplay({ sessionId, className }: SessionReplayProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<ReplayState>({ status: "pending" })

  useEffect(() => {
    const video = videoRef.current

    if (!video) return

    // Back to pending whenever the session changes. Selecting one run's replay
    // after another reuses this component rather than remounting it, and without
    // this the previous recording's "ready" would survive into the new one —
    // showing a player for a playlist that is still being polled for.
    setState({ status: "pending" })

    // The effect outlives its own awaits, so every resumption point checks this
    // before touching state or the DOM. `hls` is captured for the cleanup below
    // and can still be undefined when it runs — nothing is attached until the
    // recording is ready, which may be minutes in.
    let cancelled = false
    let hls: import("hls.js").default | undefined
    const controller = new AbortController()

    const src = `/api/replays/${encodeURIComponent(sessionId)}`

    // Waits for the route to stop answering 202. Resolves true once the
    // playlist is there, false if it gave up or failed — in which case it has
    // already set the error state and said why.
    const waitForPlaylist = async () => {
      const deadline = Date.now() + POLL_TIMEOUT_MS

      while (!cancelled) {
        let response: Response

        try {
          response = await fetch(src, { signal: controller.signal })
        } catch (error) {
          // An aborted fetch throws too, and that is an unmount rather than a
          // failure — there is no one left to show an error to, and nothing to
          // report either.
          if (cancelled) return false

          Sentry.logger.error("Replay service unreachable", { sessionId })
          Sentry.captureException(error, {
            tags: { area: "session-replay" },
            extra: { sessionId },
          })
          setState({
            status: "error",
            message: "Couldn't reach the replay service.",
          })
          return false
        }

        if (response.ok) return true

        if (response.status !== 202) {
          // 429 and 403 are the service and the plan answering as designed, so
          // they are shown and not filed. Anything else is the route breaking.
          Sentry.logger.warn("Replay unavailable", {
            sessionId,
            status: response.status,
          })

          if (response.status !== 429 && response.status !== 403) {
            Sentry.captureException(
              new Error(`Replay request failed (${response.status})`),
              { tags: { area: "session-replay" }, extra: { sessionId } }
            )
          }

          setState({
            status: "error",
            message:
              response.status === 429
                ? "Too many replay requests right now. Try again in a minute."
                : // The console locks the Replay row for a non-pro org, so this
                  // is the plan lapsing while a player is already open rather
                  // than a route anyone clicked their way to.
                  response.status === 403
                  ? "Session replay is part of the Pro plan."
                  : `Couldn't load the replay (${response.status}).`,
          })
          return false
        }

        if (Date.now() >= deadline) {
          setState({
            status: "error",
            message:
              "This recording still isn't available. The session may not have been recorded.",
          })
          return false
        }

        // Not cleared on unmount: `cancelled` is already checked by the loop
        // condition and by everything after this, so the worst a stray timer
        // costs is one no-op wake-up.
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }

      return false
    }

    const play = async () => {
      if (!(await waitForPlaylist())) return

      // Imported here rather than at the top of the file because hls.js is a
      // browser library — this keeps it out of the server render and out of the
      // bundle until something actually asks for a replay.
      const { default: Hls } = await import("hls.js")

      if (cancelled) return

      // Safari plays HLS natively and has no MediaSource for hls.js to attach
      // to, so on iOS the element is handed the playlist directly. Checked
      // first because Hls.isSupported() is false there, not because it is
      // preferable where both work.
      if (!Hls.isSupported()) {
        if (!video.canPlayType("application/vnd.apple.mpegurl")) {
          setState({
            status: "error",
            message: "This browser can't play session recordings.",
          })
          return
        }

        video.src = src
        setState({ status: "ready" })
        return
      }

      const instance = new Hls()
      hls = instance

      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        // Ready means parsed, not merely fetched: this is the first point the
        // recording is known to be playable rather than just present.
        if (!cancelled) setState({ status: "ready" })
      })

      instance.on(Hls.Events.ERROR, (_event, data) => {
        // Non-fatal errors are hls.js's normal noise — a dropped segment it
        // will fetch again. Only the fatal ones need a decision.
        if (!data.fatal || cancelled) return

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            instance.startLoad()
            break
          case Hls.ErrorTypes.MEDIA_ERROR:
            instance.recoverMediaError()
            break
          default:
            setState({ status: "error", message: "Playback failed." })
            instance.destroy()
        }
      })

      instance.loadSource(src)
      instance.attachMedia(video)
    }

    void play()

    return () => {
      cancelled = true
      controller.abort()
      hls?.destroy()
    }
  }, [sessionId])

  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-md border bg-muted",
        className
      )}
    >
      {/* Rendered from the start, not once ready: the effect needs the element
          to attach to, and it starts polling long before there is anything to
          play. The overlay covers it until then. */}
      <video
        ref={videoRef}
        controls
        playsInline
        className={cn("size-full", state.status !== "ready" && "invisible")}
      />

      {state.status !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
          {state.status === "pending" ? (
            <>
              <LoaderCircle className="size-5 animate-spin" />
              <p>Waiting for the recording&hellip;</p>
            </>
          ) : (
            <>
              <TriangleAlert className="size-5" />
              <p>{state.message}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
