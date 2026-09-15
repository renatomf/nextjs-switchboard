// How the canvas tells what ended its realtime subscription, and when it may
// start one over. Trigger.dev's React hooks never start a failed subscription
// again on their own, so the provider decides from these.

// Tokens the page mints last an hour (createRunsReadToken). Replaced after 45
// minutes, which leaves a quarter of an hour for a timer the browser holds
// back in a background tab.
export const TOKEN_REFRESH_INTERVAL_MS = 45 * 60_000

// How soon after one token refresh another may follow.
const MIN_REFRESH_GAP_MS = 60_000

// How long after the provider replaces a subscription the old one's abort can
// still land. It arrives within moments; the margin is for a busy tab.
const REPLACEMENT_ABORT_WINDOW_MS = 5_000

type ErrorWithStatus = Error & { status?: unknown }

// Whether Trigger.dev turned the subscription's token down: an expired or
// invalid token answers 401, one without the scope 403. Electric's FetchError
// carries the status.
export function isRealtimeAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const { status } = error as ErrorWithStatus

  return status === 401 || status === 403
}

// Whether the subscription ended because its request was aborted, rather than
// because the connection or Trigger.dev failed. fetch's own abort is an
// AbortError. Electric wraps one that lands while it is reading a response in
// a FetchError carrying that response's status, which is not a failure, and
// the abort's message ("The user aborted a request.").
export function isSubscriptionAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  if (error.name === "AbortError") return true

  const { status } = error as ErrorWithStatus
  const answeredWithFailure = typeof status === "number" && status >= 400

  return !answeredWithFailure && /\babort/i.test(error.message)
}

// Whether an abort is the old subscription's, from the provider replacing it
// a moment ago. Replacing a subscription aborts the old one, whose abort then
// lands in the state it shares with the new one. Starting over for that
// abort would replace the subscription again, and loop.
export function isAbortFromReplacement(
  lastResubscribedAt: number | undefined,
  now: number
): boolean {
  return (
    lastResubscribedAt !== undefined &&
    now - lastResubscribedAt < REPLACEMENT_ABORT_WINDOW_MS
  )
}

// Whether a refused token may be answered with a new one. A token refused
// right after a new one was minted is not an expired token, and minting yet
// another would only loop.
export function mayRefreshToken(
  lastRefreshedAt: number | undefined,
  now: number
): boolean {
  return (
    lastRefreshedAt === undefined || now - lastRefreshedAt >= MIN_REFRESH_GAP_MS
  )
}
