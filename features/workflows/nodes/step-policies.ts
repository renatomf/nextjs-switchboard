import type { StepPolicy } from "@/features/workflows/engine/run-steps"
import type { ActionNodeType } from "@/features/workflows/nodes/node-registry"

// How each node's steps are run: the time one attempt gets, and how many
// attempts a failure worth retrying earns (isRetryableStepError decides which
// those are). Every attempt runs in the run's one Browserbase session, so a
// node's attempts and the waits between them stay well inside it.
//
// Only a node that can safely do its work twice gets a second attempt. After
// a failure there is no knowing how far an attempt got, so a node that reads
// the page can repeat itself, while one that changes it cannot: a second act
// could click "Place order" again.
export const stepPolicies = {
  // Navigation is safe to repeat, and the page load itself gives up at 30 s.
  "open-url": { timeoutMs: 45_000, maxAttempts: 2, retryDelayMs: 2_000 },
  // One action on the page, which may have happened before the failure.
  act: { timeoutMs: 60_000, maxAttempts: 1, retryDelayMs: 0 },
  // Read the page and change nothing.
  extract: { timeoutMs: 60_000, maxAttempts: 2, retryDelayMs: 2_000 },
  observe: { timeoutMs: 60_000, maxAttempts: 2, retryDelayMs: 2_000 },
  // A whole loop of actions and model calls: never repeated, and given the
  // longest, since one agent step is a whole flow of its own.
  agent: { timeoutMs: 180_000, maxAttempts: 1, retryDelayMs: 0 },
  // Cheap, and safe to repeat: Resend recognises the step's idempotency key.
  "send-email": { timeoutMs: 15_000, maxAttempts: 3, retryDelayMs: 1_000 },
} satisfies Record<ActionNodeType, StepPolicy>
