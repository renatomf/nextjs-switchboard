// What a service answers when the same request, a moment later, may well go
// through: a timeout, too many requests, or trouble on its side (529 is
// Anthropic's "overloaded").
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529])

// Node's codes for a connection that dropped or never got through.
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
])

// Failures that only ever say what they are in their message: fetch's own,
// an overloaded model, and a stream from Stagehand's API cut off part-way.
const RETRYABLE_MESSAGES = [
  /fetch failed/i,
  /socket hang up/i,
  /high demand/i,
  /overloaded/i,
  /rate limit/i,
  /Stream ended without completion signal/,
]

// Stagehand's API client puts the status in its message and nowhere else:
// "HTTP error! status: 503, body: …", or "Unknown error: 402" when the session
// cannot be created.
const STATUS_IN_MESSAGE = /\bstatus:? (\d{3})\b|^Unknown error: (\d{3})$/

// How deep into an error's causes to look. fetch wraps the reason one level
// down; nothing seen here goes further than a couple.
const MAX_CAUSE_DEPTH = 5

// A step that ran past the time its node allows. The engine gives up on it,
// but cannot stop it: the attempt may still be driving the page.
export class StepTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The step took longer than ${timeoutMs / 1000} s and was stopped`)
    this.name = "StepTimeoutError"
  }
}

type ErrorFields = {
  isRetryable?: unknown
  statusCode?: unknown
  status?: unknown
  code?: unknown
}

// Whether a step that failed with this error is worth another attempt. Only
// failures known to pass get one: an error this does not recognise is not
// retried, since a retry costs the same model calls as the attempt that
// failed. The error's own word comes first (the AI SDK's isRetryable), then
// the status a service answered with, then the connection, then the message.
export function isRetryableStepError(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > MAX_CAUSE_DEPTH) return false

  // Another attempt would share the browser with the one that timed out.
  if (error instanceof StepTimeoutError) return false

  const { isRetryable, statusCode, status, code } = error as Error & ErrorFields

  if (typeof isRetryable === "boolean") return isRetryable

  const answered =
    typeof statusCode === "number"
      ? statusCode
      : typeof status === "number"
        ? status
        : undefined

  if (answered !== undefined) return RETRYABLE_STATUSES.has(answered)

  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true

  const inMessage = error.message.match(STATUS_IN_MESSAGE)

  if (inMessage) {
    return RETRYABLE_STATUSES.has(Number(inMessage[1] ?? inMessage[2]))
  }

  if (RETRYABLE_MESSAGES.some((pattern) => pattern.test(error.message))) {
    return true
  }

  return isRetryableStepError(error.cause, depth + 1)
}
