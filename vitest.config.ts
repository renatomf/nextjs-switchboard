import { fileURLToPath } from "node:url"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json, so a test imports a module the
    // same way the app does instead of through a relative path of its own.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // Pure logic only for now: no DOM, no network, no vendor SDKs. Components
    // and the Trigger.dev task get their own setup when they are first tested.
    environment: "node",
    include: ["**/*.test.ts"],
    // Build output from Next and the Trigger.dev worker holds copies of the
    // source, and would run every test a second time.
    exclude: [...configDefaults.exclude, ".next/**", ".trigger/**"],
  },
})
