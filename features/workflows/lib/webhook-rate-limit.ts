// How often a workflow's webhook may be called. Each call can start a run,
// which opens a browser and calls a model, so this is a cost ceiling as much
// as a protection: a sender in a loop is turned away rather than obeyed.
export const WEBHOOK_CALLS_PER_WINDOW = 10

// The window the calls are counted in. Fixed rather than rolling: one row per
// workflow and window in Postgres, incremented on each call, which is what
// lets two app instances share a single count instead of allowing the limit
// each.
const WINDOW_MS = 60_000

// The window a call belongs to, as the start of the minute it arrived in.
export function rateLimitWindowStart(
  now: Date,
  windowMs: number = WINDOW_MS
): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs)
}

// Whether a call is past the limit. The count includes the call being
// answered, so the first one turned away is the one past the limit.
export function isOverRateLimit(callsInWindow: number): boolean {
  return callsInWindow > WEBHOOK_CALLS_PER_WINDOW
}

// What a refusal tells the sender to wait, in seconds, for its Retry-After
// header. Never zero: a sender told to wait no time at all comes straight
// back.
export function retryAfterSeconds(
  now: Date,
  windowStart: Date,
  windowMs: number = WINDOW_MS
): number {
  const remaining = windowStart.getTime() + windowMs - now.getTime()

  return Math.max(1, Math.ceil(remaining / 1000))
}
