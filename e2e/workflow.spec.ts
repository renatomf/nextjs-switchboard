import { expect, test } from "@playwright/test"

// Creating a workflow is the shortest path that touches everything the unit
// tests stub: a server action, a redirect, the database, and the canvas that
// renders what came back. It deletes what it made, so the suite can run twice
// in a row without leaving a trail.
test("creates a workflow, opens its canvas, and deletes it", async ({
  page,
}) => {
  await page.goto("/")

  await page
    .getByRole("main")
    .getByRole("button", { name: "New workflow" })
    .click()

  // The action redirects to the workflow it created, so the URL is the first
  // proof the row exists.
  await page.waitForURL(/\/workflows\/[0-9a-f-]{36}$/)

  await expect(page.getByRole("button", { name: "Run" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Toolbar" })).toBeVisible()

  await page.getByRole("button", { name: "Workflow actions" }).click()
  await page.getByRole("menuitem", { name: "Delete workflow" }).click()

  await page.waitForURL(/\/$/)
  await expect(page.getByText("No workflow selected")).toBeVisible()
})
