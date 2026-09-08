// The Clerk plan slug for Pro, prefixed with its payer type. Org plans are
// checked as `org:<slug>` so the check can't be satisfied by a same-named user
// plan.
//
// Shared rather than written at each call site because the same string has to
// match in two places that fail differently: the client hook only mis-renders a
// lock, while the API route either leaks a paid resource or blocks a paying
// org. Changing the plan should not be a search-and-replace.
export const PRO_PLAN = "org:pro"

// Thrown — and reported — when an org asks for something its plan doesn't
// cover. A named class rather than a bare Error so a handler can tell an
// entitlement refusal (expected, actionable, fixed by upgrading) apart from a
// genuine failure, and so it groups as its own issue in Sentry instead of
// landing in whatever bucket the surrounding code throws into.
export class PlanRequiredError extends Error {
  // The plan that would have satisfied the check, so the report says what to
  // buy and not just what was refused.
  readonly plan: string

  constructor(message: string, plan: string = PRO_PLAN) {
    super(message)
    this.name = "PlanRequiredError"
    this.plan = plan
  }
}
