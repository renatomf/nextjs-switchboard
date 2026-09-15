import { PRO_PLAN_SLUG } from "@/lib/billing"

// Clerk's Backend API: the endpoint its own SDK calls for an org's
// subscription (getOrganizationBillingSubscription), called directly so the
// Trigger.dev worker needs no Clerk SDK of its own.
const CLERK_API_URL = "https://api.clerk.com/v1"

// The states in which a subscription item still carries its plan: active, and
// past due while a payment is being retried.
const ENTITLED_STATUSES = new Set(["active", "past_due"])

// Whether one of a subscription's items puts the org on Pro. Read defensively:
// the Billing API is experimental on Clerk's side, and a shape this does not
// recognise is not Pro.
export function isProSubscription(subscription: unknown): boolean {
  if (typeof subscription !== "object" || subscription === null) return false

  const items = (subscription as { subscription_items?: unknown })
    .subscription_items

  if (!Array.isArray(items)) return false

  return items.some((item) => {
    if (typeof item !== "object" || item === null) return false

    const { status, plan } = item as {
      status?: unknown
      plan?: { slug?: unknown } | null
    }

    return (
      typeof status === "string" &&
      ENTITLED_STATUSES.has(status) &&
      plan?.slug === PRO_PLAN_SLUG
    )
  })
}

// Whether an org is on Pro, asked of Clerk's Backend API: a scheduled run has
// no session to ask has() of. Only a clear answer counts. An org with no
// subscription is not Pro, and anything else Clerk answers fails, an answer
// in a shape this does not know included, so a hiccup on Clerk's side never
// turns a paying org's schedule off.
export async function fetchOrgIsPro(
  orgId: string,
  {
    secretKey,
    fetch = globalThis.fetch,
  }: {
    secretKey: string | undefined
    fetch?: typeof globalThis.fetch
  }
): Promise<boolean> {
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set")

  const response = await fetch(
    `${CLERK_API_URL}/organizations/${encodeURIComponent(orgId)}/billing/subscription`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  )

  if (response.status === 404) return false

  if (!response.ok) {
    throw new Error(
      `Clerk answered ${response.status} for the org's subscription`
    )
  }

  const answer: unknown = await response.json()

  // The Billing API is experimental on Clerk's side. Should its answer change
  // shape, reading it as "not Pro" would turn every schedule off at once, so
  // an answer that is not a subscription fails like any other unclear one.
  if (!isSubscription(answer)) {
    throw new Error(
      "Clerk's answer for the org's subscription is not a subscription"
    )
  }

  return isProSubscription(answer)
}

// Whether an answer has the shape of a subscription at all, whatever its plan.
const isSubscription = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as { subscription_items?: unknown }).subscription_items)
