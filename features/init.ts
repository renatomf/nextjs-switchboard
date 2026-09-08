import * as Sentry from "@sentry/node"
import { tasks } from "@trigger.dev/sdk"

// Trigger.dev auto-loads an `init.ts` at the root of a configured task dir
// (`dirs: ["features"]`) before any task runs. It is the documented place for
// global lifecycle hooks, and the only place a task worker can be wired up:
// tasks execute outside Next, so none of the sentry.*.config.ts files reach
// them and a failed run would otherwise be visible only in Trigger's dashboard.
//
// https://trigger.dev/docs/tasks/overview#global-lifecycle-hooks

Sentry.init({
  // Trigger runs its own OpenTelemetry SDK for the run traces in its dashboard.
  // The default integrations install a second one plus a set of auto-
  // instrumentations, and the two fight over the same global provider — errors
  // are what is wanted here, and the run trace stays where it already is.
  defaultIntegrations: false,
  dsn:
    process.env.SENTRY_DSN ??
    "https://86ff20d901da2809a228a72a4bc3b5e8@o4510082957180928.ingest.us.sentry.io/4512051355385856",
  environment:
    process.env.NODE_ENV === "production" ? "production" : "development",
})

// Global: fires for every task, so a new task is covered without touching this
// file. Runs once the retries configured in trigger.config.ts are spent, so a
// run that fails twice and then succeeds doesn't file three issues.
tasks.onFailure(({ payload, error, ctx }) => {
  Sentry.captureException(error, {
    tags: {
      runtime: "trigger.dev",
      taskId: ctx.task.id,
      environment: ctx.environment.type,
    },
    extra: {
      payload,
      ctx,
    },
  })
})
