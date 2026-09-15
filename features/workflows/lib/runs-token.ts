import "server-only"

import { auth } from "@trigger.dev/sdk"

import { workflowRunTag } from "@/features/workflows/lib/run-ownership"

// The Trigger.dev token the browser subscribes to a workflow's runs with.
// Read-only and scoped to that one workflow's tag, so it reaches this
// workflow's runs and nothing else. The default expiry is 15 minutes, which is
// short for a canvas left open; the canvas replaces it before the hour is up
// (createRunsTokenAction).
export function createRunsReadToken(workflowId: string) {
  return auth.createPublicToken({
    scopes: { read: { tags: [workflowRunTag(workflowId)] } },
    expirationTime: "1hr",
  })
}
