// How long Browserbase had a session open, which is the quantity it bills.
// Pure: it takes the two stamps the session reports and returns seconds, so
// the rules below are testable without the API.

// Only the fields the duration needs. The session carries more, and none of it
// belongs in this decision. `endedAt` is absent while the session is still
// open, which for a settled run means Browserbase has not finished closing it.
export type TimedSession = {
  startedAt: string
  endedAt?: string
}

// The seconds the session was open, or nothing when it cannot be said: no end
// yet, a stamp that will not parse, or an end before its start. A negative
// duration is a broken record — clocks disagree across machines — and billing
// a negative session would quietly subtract from every total it lands in.
export function sessionSecondsOf(session: TimedSession): number | null {
  if (!session.endedAt) return null

  const started = Date.parse(session.startedAt)
  const ended = Date.parse(session.endedAt)

  if (Number.isNaN(started) || Number.isNaN(ended)) return null

  const seconds = (ended - started) / 1000

  return seconds < 0 ? null : Math.round(seconds)
}
