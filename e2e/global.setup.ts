import { clerkSetup } from "@clerk/testing/playwright"
import { test as setup } from "@playwright/test"

// Obtains a Testing Token once for the whole suite. Without it Clerk's bot
// detection refuses the automated sign-in, and the failure reads like a broken
// password rather than a missing token.
setup("obtain a Clerk testing token", async () => {
  await clerkSetup({
    // The app's own variable, rather than asking for the same key twice under
    // the name @clerk/testing looks for by default.
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  })
})
