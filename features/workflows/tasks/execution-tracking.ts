import type { StagehandMetrics } from "@browserbasehq/stagehand"
import * as Sentry from "@sentry/node"

import {
  advanceExecution,
  recordExecutionTokens,
  setExecutionBrowserSession,
} from "@/features/workflows/data"
import type { ExecutionEvent } from "@/features/workflows/lib/execution-status"
import type { RunWorkflowPayload } from "@/features/workflows/tasks/load-run-graph"
import { redactSecrets } from "@/lib/redact"

// Capped like a step's error, so one runaway message cannot bloat the row.
const ERROR_CHAR_CAP = 2_000

// Records what a lifecycle hook saw on the run's execution. Never throws:
// Trigger.dev ignores errors in most hooks, and one in onStartAttempt would
// fail the run over a bookkeeping write. A failed write is reported instead,
// since it leaves the execution behind the run.
export async function trackExecution(
  runId: string,
  payload: RunWorkflowPayload,
  event: ExecutionEvent,
  error?: unknown
) {
  try {
    await advanceExecution({
      runId,
      orgId: payload.orgId,
      workflowId: payload.workflowId,
      versionId: payload.versionId,
      event,
      // Redacted before it is capped, not after: cutting first could leave
      // half a credential in the row, which is still a leak and no longer
      // matches the shape that would have caught it.
      error:
        error === undefined
          ? undefined
          : redactSecrets(
              error instanceof Error ? error.message : String(error)
            ).slice(0, ERROR_CHAR_CAP),
    })
  } catch (writeError) {
    Sentry.captureException(writeError, {
      tags: { area: "executions", event },
      extra: { runId },
    })
  }
}

// Records the browser session a run opened, which is what lets the replay
// route tie the recording to an org. Never throws either: without it the
// route refuses the recording, the safe way to fail, and the run carries on.
export async function trackBrowserSession(runId: string, sessionId: string) {
  try {
    await setExecutionBrowserSession(runId, sessionId)
  } catch (writeError) {
    Sentry.captureException(writeError, {
      tags: { area: "executions", event: "browser-session" },
      extra: { runId, sessionId },
    })
  }
}

// Records what the models consumed, read off the browser on its way out. Only
// the instance knows: closing it takes the counts with it, so this is the last
// moment to ask.
//
// Takes the reading as well as the write, so one failure is reported once and
// in one place. Never throws, like the two above — the browser session's
// beforeClose swallows what escapes anyway, and a run must not fail over
// accounting. What it must not do is fail silently, hence the report: a count
// that stops arriving is a number that quietly goes missing from every report
// after it.
export async function trackTokenUsage(
  runId: string,
  browser: { metrics: Promise<StagehandMetrics> }
) {
  try {
    const metrics = await browser.metrics

    await recordExecutionTokens(runId, {
      promptTokens: metrics.totalPromptTokens,
      completionTokens: metrics.totalCompletionTokens,
      reasoningTokens: metrics.totalReasoningTokens,
      cachedInputTokens: metrics.totalCachedInputTokens,
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { area: "executions", event: "token-usage" },
      extra: { runId },
    })
  }
}
