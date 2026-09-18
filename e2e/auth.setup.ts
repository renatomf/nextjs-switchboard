import { clerk } from "@clerk/testing/playwright"
import { expect, test as setup } from "@playwright/test"

import { STORAGE_STATE } from "../playwright.config"

// The part of Clerk's browser client this setup uses. Typed here rather than
// cast away, so a change in their API surfaces as a type error instead of a
// timeout with no explanation.
type ClerkWindow = Window & {
  Clerk?: {
    user?: {
      organizationMemberships: {
        organization: { id: string; name: string }
      }[]
    }
    setActive: (params: { organization: string }) => Promise<void>
  }
}

// Named rather than defaulted: a wrong guess here signs the suite in as the
// wrong person, or points it at another organization's data, and both fail in
// ways that do not say so.
function required(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local — the e2e suite needs to know which user and organization to run as.`
    )
  }

  return value
}

// Signs in once and writes the state every other test starts from. Doing this
// per test would be slow, and would spend most of the suite testing Clerk
// instead of this app.
setup("sign in and activate the test organization", async ({ page }) => {
  const emailAddress = required("E2E_CLERK_USER_EMAIL")
  const organization = required("E2E_CLERK_ORG_NAME")

  // clerk.signIn needs a page that already has Clerk loaded and does not
  // itself require a session.
  await page.goto("/sign-in")
  await clerk.signIn({ page, emailAddress })

  // Signing in restores whichever organization this user had active last — the
  // one they actually work in, which is exactly the one the tests must not
  // touch. Everything in this app is scoped by organization, so choosing the
  // right one is part of being signed in.
  //
  // Done through Clerk's own client rather than its switcher menu: that menu is
  // Clerk's interface to test, not ours, and its markup is not a contract we
  // can hold them to.
  await page.goto("/")
  await page.waitForFunction(() => Boolean((window as ClerkWindow).Clerk?.user))

  await page.evaluate(async (name) => {
    const clerk = (window as ClerkWindow).Clerk
    const membership = clerk?.user?.organizationMemberships.find(
      (m) => m.organization.name === name
    )

    if (!membership) {
      throw new Error(`The signed-in user is not a member of "${name}"`)
    }

    await clerk.setActive({ organization: membership.organization.id })
  }, organization)

  // Proves the switch took, and that the app rendered for that organization —
  // not just that a promise resolved.
  await page.goto("/")
  await expect(page.getByText(organization, { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText("No workflow selected")).toBeVisible()

  await page.context().storageState({ path: STORAGE_STATE })
})
