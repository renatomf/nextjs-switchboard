import { defineConfig, devices } from "@playwright/test"

// The same file Next reads. Playwright runs in its own process and would not
// see it otherwise, and the alternative — asking for the Clerk keys a second
// time under different names — is one more thing to keep in sync.
try {
  process.loadEnvFile(".env.local")
} catch {
  // Absent in CI, where the values come from the environment itself.
}

// Where the tests point. Defaults to the dev server this config starts; set it
// to a deployment's URL to run the same suite against a preview.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000"

// Signed-in state, written once by e2e/auth.setup.ts and reused by every test:
// signing in through the UI in each test would be slow and would test Clerk
// rather than this app.
export const STORAGE_STATE = "e2e/.auth/user.json"

export default defineConfig({
  testDir: "./e2e",
  // Named .spec.ts on purpose: Vitest owns **/*.test.ts, and the two runners
  // must not pick up each other's files.
  testMatch: /.*\.spec\.ts/,
  // This app allows one run per workflow and the tests share one organization,
  // so parallel files would contend for the same state.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    // Preview deployments sit behind Vercel's deployment protection, which
    // answers an automated request with a redirect to a login page — every
    // test would fail at the sign-in step, for a reason that has nothing to do
    // with this app. The bypass secret is sent on every request instead of
    // turning the protection off: a preview carries a copy of production data.
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass":
              process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          },
        }
      : {}),
    // Kept only for a failure, where it is the difference between "it broke"
    // and knowing which step broke it.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup clerk",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "setup auth",
      testMatch: /auth\.setup\.ts/,
      dependencies: ["setup clerk"],
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup auth"],
    },
  ],
  // Skipped when E2E_BASE_URL points somewhere already running.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
