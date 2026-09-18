import { expect, test } from "@playwright/test"

// The first thing worth proving end to end, and the thing 469 unit tests
// cannot: that Clerk, the organization scope, the database and the rendering
// all line up for a signed-in person. It writes nothing — the database is
// shared with production until the preview environments of phase E exist.
test("the dashboard renders for a signed-in member of an organization", async ({
  page,
}) => {
  await page.goto("/")

  await expect(page.getByText("No workflow selected")).toBeVisible()

  // Scoped to the main region on purpose: the sidebar has its own "New
  // workflow" control, and an unscoped locator would match both and pass or
  // fail for reasons that have nothing to do with the empty state.
  await expect(
    page.getByRole("main").getByRole("button", { name: "New workflow" })
  ).toBeVisible()
})
