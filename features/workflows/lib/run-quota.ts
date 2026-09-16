// How many runs an organization may start in a month, by plan. Every run
// opens a browser session and calls a model, so this is the ceiling on what a
// month can cost. Here in one place because the number is a product decision
// that will change, and because the check and the message a user reads have to
// agree on it.
export const RUN_QUOTAS = { free: 20, pro: 500 } as const

export function runQuotaFor(isPro: boolean): number {
  return isPro ? RUN_QUOTAS.pro : RUN_QUOTAS.free
}

// An organization's month as the interface shows it: what it has spent, and
// what its plan allows. The limit travels with the count because the browser
// has no business deciding what a plan is worth.
export type RunUsage = { used: number; limit: number }

// Runs are counted per calendar month in UTC: everyone's month turns at the
// same instant, rather than each organization's counting from whenever it
// happened to sign up.
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

function nextMonthStart(now: Date): Date {
  // Month 12 rolls into January of the next year on its own.
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

// Whether a month already counted has no room left. Where the ceiling itself
// lives: the server asks it by plan, the sidebar asks it by the numbers it was
// given, and neither gets to spell out the comparison on its own.
export function isUsageOverQuota({ used, limit }: RunUsage): boolean {
  return used >= limit
}

// Whether the next run would be past the quota. The count is of runs already
// started this month, so the quota is how many a month holds: with a quota of
// 20, the twentieth run goes and the twenty-first is refused.
export function isOverRunQuota(runsThisMonth: number, isPro: boolean): boolean {
  return isUsageOverQuota({ used: runsThisMonth, limit: runQuotaFor(isPro) })
}

// What a refused caller is told to wait, in seconds. Never zero: a sender told
// to wait no time at all comes straight back to the same refusal.
export function secondsUntilNextMonth(now: Date): number {
  const remaining = nextMonthStart(now).getTime() - now.getTime()

  return Math.max(1, Math.ceil(remaining / 1000))
}
