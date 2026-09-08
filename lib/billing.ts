// The Clerk plan slug for Pro, prefixed with its payer type. Org plans are
// checked as `org:<slug>` so the check can't be satisfied by a same-named user
// plan.
//
// Shared rather than written at each call site because the same string has to
// match in two places that fail differently: the client hook only mis-renders a
// lock, while the API route either leaks a paid resource or blocks a paying
// org. Changing the plan should not be a search-and-replace.
export const PRO_PLAN = "org:pro"
