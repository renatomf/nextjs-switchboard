import { describe, expect, it, vi } from "vitest"

import { fetchOrgIsPro, isProSubscription } from "./org-plan"

// An org's billing subscription as Clerk's Backend API sends it.
const subscription = (items: { status: string; slug?: string }[]) => ({
  object: "commerce_subscription",
  status: "active",
  subscription_items: items.map(({ status, slug }) => ({
    status,
    plan: slug ? { slug } : null,
  })),
})

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

describe("isProSubscription", () => {
  it("is Pro with an active Pro item", () => {
    expect(
      isProSubscription(subscription([{ status: "active", slug: "pro" }]))
    ).toBe(true)
  })

  // A payment still being retried leaves the org on its plan for now: a
  // paying org's schedule is not turned off over it.
  it("is still Pro while a payment is past due", () => {
    expect(
      isProSubscription(subscription([{ status: "past_due", slug: "pro" }]))
    ).toBe(true)
  })

  it("is not Pro on another plan", () => {
    expect(
      isProSubscription(subscription([{ status: "active", slug: "free_org" }]))
    ).toBe(false)
  })

  it.each([
    "canceled",
    "ended",
    "expired",
    "upcoming",
    "incomplete",
    "abandoned",
  ])("is not Pro with a Pro item that is %s", (status) => {
    expect(isProSubscription(subscription([{ status, slug: "pro" }]))).toBe(
      false
    )
  })

  // A downgrade keeps the old item as ended next to the new one.
  it("is Pro when any one item is an active Pro one", () => {
    expect(
      isProSubscription(
        subscription([
          { status: "ended", slug: "free_org" },
          { status: "active", slug: "pro" },
        ])
      )
    ).toBe(true)
  })

  it("is not Pro for something that is not a subscription", () => {
    expect(isProSubscription(null)).toBe(false)
    expect(isProSubscription({ subscription_items: "pro" })).toBe(false)
    expect(isProSubscription(subscription([]))).toBe(false)
  })
})

// A scheduled run has no Clerk session to ask has() of, so it asks Clerk's
// Backend API about the org instead.
describe("fetchOrgIsPro", () => {
  it("asks Clerk for the org's subscription with the secret key", async () => {
    const fetch = vi.fn(async () =>
      respond(subscription([{ status: "active", slug: "pro" }]))
    )

    await expect(
      fetchOrgIsPro("org_a", { secretKey: "sk_test_1", fetch })
    ).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      "https://api.clerk.com/v1/organizations/org_a/billing/subscription",
      { headers: { Authorization: "Bearer sk_test_1" } }
    )
  })

  it("keeps the org id to its own part of the URL", async () => {
    const fetch = vi.fn(async () => respond(subscription([])))

    await fetchOrgIsPro("org_a/../users", { secretKey: "sk_test_1", fetch })

    expect(fetch).toHaveBeenCalledWith(
      "https://api.clerk.com/v1/organizations/org_a%2F..%2Fusers/billing/subscription",
      expect.anything()
    )
  })

  it("is not Pro for an org with no subscription", async () => {
    const fetch = vi.fn(async () => respond({ errors: [] }, 404))

    await expect(
      fetchOrgIsPro("org_a", { secretKey: "sk_test_1", fetch })
    ).resolves.toBe(false)
  })

  it("is not Pro for an org subscribed to another plan", async () => {
    const fetch = vi.fn(async () =>
      respond(subscription([{ status: "active", slug: "free_org" }]))
    )

    await expect(
      fetchOrgIsPro("org_a", { secretKey: "sk_test_1", fetch })
    ).resolves.toBe(false)
  })

  // The Billing API is experimental on Clerk's side. Should its answer change
  // shape, reading it as "not Pro" would turn every schedule off at once, so
  // an answer that is not a subscription fails instead.
  it("fails rather than answer when Clerk's answer is not a subscription", async () => {
    const fetch = vi.fn(async () => respond({ billing: { plan: "pro" } }))

    await expect(
      fetchOrgIsPro("org_a", { secretKey: "sk_test_1", fetch })
    ).rejects.toThrow("not a subscription")
  })

  // Anything short of a clear answer must not turn a paying org's schedule
  // off: it fails, and the next scheduled run asks again.
  it.each([401, 429, 500, 503])(
    "fails rather than answer when Clerk says %i",
    async (status) => {
      const fetch = vi.fn(async () => respond({ errors: [] }, status))

      await expect(
        fetchOrgIsPro("org_a", { secretKey: "sk_test_1", fetch })
      ).rejects.toThrow(`Clerk answered ${status}`)
    }
  )

  it("fails without a secret key", async () => {
    await expect(
      fetchOrgIsPro("org_a", { secretKey: undefined, fetch: vi.fn() })
    ).rejects.toThrow("CLERK_SECRET_KEY is not set")
  })
})
