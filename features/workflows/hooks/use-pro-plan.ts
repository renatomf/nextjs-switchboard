"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@clerk/nextjs"

import { PRO_PLAN } from "@/lib/billing"

// Where <PricingTable for="organization" /> lives.
export const BILLING_PATH = "/billing"

export type ProPlan = {
  // False until Clerk has resolved the session — treat it as "don't know yet"
  // rather than "not subscribed", or a gated UI flashes its upgrade state on
  // every load and after every org switch.
  isLoaded: boolean
  // Whether the *active* organization is subscribed to Pro. Switching orgs
  // re-evaluates this, so a component reading it never has to re-check orgId.
  isPro: boolean
  // Sends the user to the billing page to subscribe. Client-side navigation,
  // so the dashboard shell and sidebar stay mounted.
  goToBilling: () => void
}

// Whether the active org is on Pro, plus a way to send someone to the billing
// page to upgrade. Gate on `isPro` and hang `goToBilling` off the upgrade CTA:
//
//   const { isLoaded, isPro, goToBilling } = useProPlan()
//   if (!isLoaded) return <Skeleton />
//   return isPro ? <Thing /> : <Button onClick={goToBilling}>Upgrade</Button>
//
// Client-side only. `has()` reads the session token, so a plan bought in this
// tab shows up once Clerk refreshes the session after checkout — gate anything
// that actually costs money on the server with `auth()` as well.
export function useProPlan(): ProPlan {
  const auth = useAuth()
  const router = useRouter()

  const goToBilling = useCallback(() => {
    router.push(BILLING_PATH)
  }, [router])

  return {
    isLoaded: auth.isLoaded,
    // `has` is present on every branch of useAuth's union — the signed-out and
    // still-loading ones just always return false.
    isPro: auth.isLoaded && auth.has({ plan: PRO_PLAN }),
    goToBilling,
  }
}
