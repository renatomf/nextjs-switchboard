import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin"
import { esbuildPlugin } from "@trigger.dev/build/extensions"
import { defineConfig } from "@trigger.dev/sdk"

export default defineConfig({
  project: "proj_vibhoylenbwxjwtffamq",
  runtime: "node-24",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["features"],
  build: {
    extensions: [
      // Uploads the deployed bundle's source maps to Sentry, so a stack trace
      // from a failed run points at the TypeScript that was written instead of
      // the bundled output. Deploy-only and placed last: there is nothing to
      // upload from a dev run, and the plugin has to see the final bundle.
      esbuildPlugin(
        sentryEsbuildPlugin({
          org: "ammodev",
          project: "switchboard",
          // Set SENTRY_AUTH_TOKEN in the Trigger.dev environment for deploys;
          // locally it comes from the gitignored .env.sentry-build-plugin.
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
        { placement: "last", target: "deploy" }
      ),
    ],
    // Stagehand ships a Chrome extension zip that it uploads to Browserbase on
    // session start, and it finds that zip by walking up from its own file. Once
    // bundled, that walk lands inside .trigger/ instead of node_modules and the
    // read fails, surfacing as "Failed to upload the Stagehand extension". Keeping
    // the package external leaves it in node_modules with its assets intact.
    external: ["@browserbasehq/stagehand"],
  },
})
